# Migração dos Banners Institucionais para o Gestão de Ouvintes com Cloudflare R2

> **Para agentes de implementação:** usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar este plano tarefa por tarefa. Cada etapa usa checkbox para acompanhamento.

**Objetivo:** transferir a gestão dos banners promocionais do Hero do `cms-feitoamao`/`PortalGtf` para o `GestaoOuvintes`, armazenar as imagens no Cloudflare R2 e servi-las por CDN, preservando o banner branco central como slide fixo e imutável do site institucional.

**Arquitetura:** o PostgreSQL do `api-ouvintes` será a fonte de verdade dos metadados e da ordem dos banners. O painel administrativo enviará imagens para uma rota autenticada da API; a API validará e otimizará os arquivos antes de gravá-los no R2 por meio de um adaptador de storage. O institucional consultará uma rota pública que retorna apenas banners ativos e URLs CDN resolvidas a partir de `object_key`, mantendo o Hero branco local sempre na primeira posição.

**Stack:** Node.js 24, TypeScript, Fastify 5, PostgreSQL 16, Drizzle ORM, Zod, `@fastify/multipart`, Sharp, AWS SDK for JavaScript v3 (S3-compatible API), Cloudflare R2, React 18, Vite, Tailwind CSS, TanStack React Query, Vitest e Testing Library.

AVISO-WARNING-ALERTA: EM HIPÓTESE ALGUMA, ULTRAPASSE O LIMITE GRATUITO, OU UTILIZE FERRAMENTAS DO R2 QUE NÃO É PARA SER UTILIZADA, VAMOS APENAS SUBIR IMGENS E CONSUMIR IMAGENS DO. R2 NO MODELO GRATUITO QUE ESTÁ SETAO.

## Agentes responsáveis

- **Tech Lead / Arquiteto:** fronteiras entre CMS antigo, Gestão de Ouvintes, R2 e institucional; estratégia de migração e rollback.
- **Backend API Engineer:** contratos, upload, CRUD, publicação, ordenação e endpoint público.
- **Database Engineer:** migração PostgreSQL, índices, constraints e auditoria.
- **CMS Frontend Engineer:** inventário e retirada segura da funcionalidade do `cms-feitoamao`.
- **Institutional Frontend Engineer:** consumo do endpoint e composição do Hero fixo + banners dinâmicos.
- **Mobile First / Mobile Engineer:** editor responsivo no painel e comportamento do Hero em telas pequenas.
- **Security Engineer:** validação de arquivos, autorização, SSRF em links e proteção das credenciais R2.
- **DevOps / Release Engineer:** bucket, domínio CDN, secrets, cache, backup e deploy.
- **QA Engineer:** contratos, uploads, ordenação, fallback e regressão do Hero.
- **Documentation Engineer:** atualização das documentações do Gestão de Ouvintes e do institucional.

## Restrições globais

- O banner branco `hero-static`, com texto e botões, permanece local, fixo e não editável pelo painel.
- O endpoint público retorna somente banners promocionais ativos; o frontend adiciona o banner branco como primeiro slide.
- Não armazenar domínio completo do CDN como dado canônico. Persistir somente `object_key`; resolver a URL com `R2_PUBLIC_BASE_URL`.
- Nunca expor `R2_ACCESS_KEY_ID` ou `R2_SECRET_ACCESS_KEY` em variáveis `VITE_*`.
- Não aceitar executáveis, HTML ou SVG na primeira entrega. Tipos permitidos: JPEG, PNG, WebP e AVIF.
- Limite inicial por arquivo: 10 MiB antes da otimização.
- Gerar nome imutável: `institutional/banners/YYYY/MM/<uuid>.<ext>`.
- O link do banner é opcional; quando informado, aceitar somente `https:` em produção e `http:` apenas em desenvolvimento local.
- Exclusão de banner será lógica; objetos substituídos não serão removidos imediatamente do R2.
- Toda mutação administrativa exige autenticação e permissão no backend.
- O frontend público deve continuar funcional se a API ou o CDN estiverem indisponíveis.
- A UI administrativa deve ser Mobile First e acessível por teclado.

---

## 1. Diagnóstico atual

### CMS e PortalGtf

O módulo atual está em:

```text
cms-feitoamao/src/pages/BannersInstitucionaisList.tsx
cms-feitoamao/src/services/api.ts
PortalGtf/PortalGtf.API/Controllers/BannerInstitucionalController.cs
PortalGtf/PortalGtf.Application/Services/BannerInstitucionalServices/
PortalGtf/PortalGtf.Core/Entities/BannerInstitucional.cs
```

O contrato existente contém `titulo`, `emissoraId`, `midiaId`, `linkUrl`, `novaAba`, `posicao`, `ordem` e `ativo`. A tela depende da biblioteca geral de mídias do PortalGtf e não faz upload específico de banner.

### Site institucional

O Hero atual está em `radio-88-fm-institucional/src/pages/Index.tsx` e usa:

```ts
const heroSlides = [
  { type: "static", id: "hero-static" },
  ...staticHeroBanners.map((banner) => ({ ...banner, type: "banner" as const })),
];
```

A antiga leitura de `PortalGtf/api/banner-institucional/ativos` está comentada. Portanto, o corte não deve reativar esse endpoint; deve criar integração nova com `api-ouvintes`.

### Gestão de Ouvintes

O `GestaoOuvintes` já possui PostgreSQL, autenticação administrativa, campanhas, painel protegido, TanStack Query e base de RBAC. O novo módulo deve seguir as mesmas divisões:

```text
api-ouvintes/src/routes
api-ouvintes/src/schemas
api-ouvintes/src/services
api-ouvintes/src/database
painel-adm/src/pages
painel-adm/src/services
painel-adm/src/types
```

## 2. Decisão arquitetural

### Alternativas consideradas

1. **Continuar usando PortalGtf e apenas mover a tela:** menor esforço imediato, mas mantém o institucional acoplado ao CMS editorial e ao MySQL. Não recomendado.
2. **Upload direto do painel ao R2 com URL pré-assinada:** escala bem, mas exige CORS no bucket, fluxo de confirmação e validação pós-upload. É útil para arquivos grandes, porém adiciona complexidade desnecessária para poucos banners pequenos.
3. **Upload mediado pela `api-ouvintes` para o R2:** permite validar bytes reais, dimensões e MIME, otimizar com Sharp e manter credenciais/CORS centralizados. **Recomendado para esta fase.**

### Fluxo escolhido

```text
Administrador
  -> painel-adm /banners-institucionais
  -> POST multipart api-ouvintes /api/admin/institutional-banners/assets
  -> validação + otimização
  -> Cloudflare R2 (objeto privado para escrita)
  -> PostgreSQL (object_key + metadados)
  -> CRUD/ordenação/publicação

Visitante
  -> radio-88-fm-institucional
  -> GET /api/public/institutional-banners?placement=home_hero
  -> banner branco local + banners dinâmicos
  -> imagens em https://media.<dominio>/<object_key>
```

## 3. Modelo de dados proposto

Criar a migração `GestaoOuvintes/api-ouvintes/database/migrations/0003_institutional_banners_r2.sql`.

### `media_asset`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` | PK com `gen_random_uuid()` |
| `storage_provider` | `varchar(20)` | `r2`, preparado para outros providers |
| `object_key` | `varchar(1024)` | único; sem domínio |
| `original_name` | `varchar(255)` | nome sanitizado para auditoria |
| `mime_type` | `varchar(100)` | MIME detectado/normalizado |
| `byte_size` | `bigint` | tamanho final no R2 |
| `width` | `integer` | largura final |
| `height` | `integer` | altura final |
| `etag` | `varchar(255)` | ETag retornado pelo R2 |
| `status` | `varchar(20)` | `ready`, `orphaned`, `deleted` |
| `created_by_admin_user_id` | `uuid` | FK para `admin_user` |
| `created_at` | `timestamptz` | criação |
| `updated_at` | `timestamptz` | atualização |

### `institutional_banner`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `title` | `varchar(160)` | obrigatório |
| `alt_text` | `varchar(220)` | obrigatório para acessibilidade |
| `placement_key` | `varchar(80)` | inicialmente `home_hero` |
| `media_asset_id` | `uuid` | FK `restrict` para `media_asset` |
| `destination_url` | `varchar(2048)` | opcional |
| `open_in_new_tab` | `boolean` | padrão `false` |
| `display_order` | `integer` | inteiro positivo |
| `active` | `boolean` | padrão `false` |
| `created_by_admin_user_id` | `uuid` | FK para `admin_user` |
| `updated_by_admin_user_id` | `uuid` | FK para `admin_user` |
| `deleted_at` | `timestamptz` | soft delete |
| `created_at` | `timestamptz` | criação |
| `updated_at` | `timestamptz` | atualização |

### Constraints e índices

- `CHECK (display_order > 0)`.
- Índice parcial para consulta pública em `(placement_key, active, display_order)` onde `deleted_at IS NULL`.
- Índice em `media_asset(status, created_at)` para limpeza de órfãos.
- Não impor unicidade permanente em `display_order`; a API fará reordenação transacional para evitar conflitos durante drag-and-drop.
- Adicionar permissões `institutional_banner.read`, `institutional_banner.manage` e `media.upload` à base de RBAC, atribuídas inicialmente à função `admin`.
- Registrar `create`, `update`, `activate`, `deactivate`, `reorder`, `delete` e `asset.upload` em `admin_audit_log` sem gravar conteúdo binário ou secrets.

## 4. Contratos da API

### Contrato público

`GET /api/public/institutional-banners?placement=home_hero`

Resposta:

```json
{
  "version": 12,
  "items": [
    {
      "id": "uuid",
      "title": "Aniversário 32 anos",
      "altText": "Banner comemorativo dos 32 anos da Rádio 88 FM",
      "imageUrl": "https://media.radio88fm.com.br/institutional/banners/2026/07/uuid.webp",
      "destinationUrl": "https://radio88fm.com.br/nossa-radio",
      "openInNewTab": false,
      "order": 1
    }
  ]
}
```

Regras:

- Não retornar banners inativos, excluídos ou assets diferentes de `ready`.
- Ordenar por `display_order`, depois `created_at`.
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
- Gerar `ETag` com base em `version`/última atualização e responder `304` a `If-None-Match`.
- Não incluir o banner branco no retorno.

### Contratos administrativos

```text
GET    /api/admin/institutional-banners
POST   /api/admin/institutional-banners/assets
POST   /api/admin/institutional-banners
PUT    /api/admin/institutional-banners/:id
PUT    /api/admin/institutional-banners/reorder
POST   /api/admin/institutional-banners/:id/activate
POST   /api/admin/institutional-banners/:id/deactivate
DELETE /api/admin/institutional-banners/:id
```

Upload multipart:

```text
field: file
Content-Type: image/jpeg | image/png | image/webp | image/avif
max: 10 MiB
```

Reordenação atômica:

```json
{
  "placementKey": "home_hero",
  "orderedIds": ["uuid-3", "uuid-1", "uuid-2"]
}
```

A API deve validar que todos os IDs pertencem ao mesmo placement, estão ativos no conjunto esperado e não estão excluídos. A atualização ocorre dentro de uma transação.

## 5. Cloudflare R2 e CDN

### Configuração manual no Cloudflare

- [ ] Criar um bucket privado para escrita, por exemplo `radio88-institutional-media`.
- [ ] Criar um API Token R2 limitado ao bucket, com leitura e escrita de objetos; não usar token global da conta.
- [ ] Registrar `Account ID`, `Access Key ID` e `Secret Access Key` somente no ambiente da API.
- [ ] Para desenvolvimento, habilitar temporariamente o domínio `r2.dev` apenas se necessário.
- [ ] Para produção, conectar um domínio próprio, por exemplo `media.radio88fm.com.br`, em **R2 > Bucket > Settings > Custom Domains**.
- [ ] Desabilitar o acesso `r2.dev` após ativar o domínio de produção.
- [ ] Criar Cache Rule para `/institutional/banners/*`, respeitando `Cache-Control` do objeto e permitindo cache longo.
- [ ] Ativar Smart Tiered Cache se disponível no plano.
- [ ] Configurar alertas de uso/custos e revisar operações Classe A/B mensalmente.

O domínio `r2.dev` é indicado apenas para desenvolvimento e pode sofrer rate limit. Em produção, o custom domain permite cache, regras e analytics no Cloudflare. Consulte [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) e [R2 limits](https://developers.cloudflare.com/r2/platform/limits/).

### Variáveis da API

Adicionar a `GestaoOuvintes/api-ouvintes/.env.example`:

```env
MEDIA_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=radio88-institutional-media
R2_PUBLIC_BASE_URL=https://media.radio88fm.com.br
R2_OBJECT_PREFIX=institutional/banners
INSTITUTIONAL_BANNER_MAX_BYTES=10485760
```

O cliente S3 usa `region: "auto"` e endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. O R2 oferece API compatível com S3; consultar [S3 API](https://developers.cloudflare.com/r2/get-started/s3/).

### Política de objetos

- Converter imagens JPEG/PNG para WebP de alta qualidade, preservando transparência quando aplicável.
- Aplicar `Cache-Control: public, max-age=31536000, immutable` porque cada substituição gera uma nova `object_key`.
- Preservar proporção; não esticar para dimensões fixas.
- Validar dimensões mínimas recomendadas no painel e API; sugestão inicial: 1200 x 675 px.
- Não sobrescrever a mesma chave. Uma troca cria novo asset e marca o antigo como `orphaned`.
- Remover assets órfãos somente após janela de segurança de 30 dias e confirmação de ausência de referência.
- Manter regra padrão do R2 para abortar multipart incompleto; embora a primeira fase use upload simples, isso prepara evolução futura. Consulte [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## 6. Estrutura de arquivos planejada

### API

```text
GestaoOuvintes/api-ouvintes/
├── database/migrations/0003_institutional_banners_r2.sql
├── src/config/env.ts
├── src/database/schema.ts
├── src/routes/admin-institutional-banners.ts
├── src/routes/public-institutional-banners.ts
├── src/schemas/institutional-banner.ts
├── src/services/institutional-banner-service.ts
├── src/services/media-storage/
│   ├── media-storage.ts
│   ├── r2-media-storage.ts
│   └── media-image-processor.ts
└── tests/
    ├── integration/institutional-banners.test.ts
    └── unit/media-image-processor.test.ts
```

### Painel administrativo

```text
GestaoOuvintes/painel-adm/src/
├── pages/InstitutionalBannersPage.tsx
├── components/banners/BannerFormDialog.tsx
├── components/banners/BannerList.tsx
├── components/banners/BannerPreview.tsx
├── components/banners/BannerOrderList.tsx
├── services/api.ts
├── types/api.ts
└── App.tsx
```

### Site institucional

```text
radio-88-fm-institucional/src/
├── services/institutional-banners/api.ts
├── services/institutional-banners/types.ts
├── hooks/useInstitutionalBanners.ts
├── pages/Index.tsx
└── vite-env.d.ts
```

### CMS legado

```text
cms-feitoamao/src/App.tsx
cms-feitoamao/src/components/cms/CMSLayout.tsx
cms-feitoamao/src/config/access-control.ts
cms-feitoamao/src/pages/BannersInstitucionaisList.tsx
```

Não excluir o código legado no primeiro release; retirar menu/rota e documentar o novo proprietário do recurso. A remoção física ocorrerá após o período de rollback.

---

## 7. Plano de implementação passo a passo

### Tarefa 1: Preparar infraestrutura R2 e adapter de storage

**Arquivos:**

- Modificar: `GestaoOuvintes/api-ouvintes/package.json`
- Modificar: `GestaoOuvintes/api-ouvintes/src/config/env.ts`
- Criar: `GestaoOuvintes/api-ouvintes/src/services/media-storage/media-storage.ts`
- Criar: `GestaoOuvintes/api-ouvintes/src/services/media-storage/r2-media-storage.ts`
- Criar: `GestaoOuvintes/api-ouvintes/src/services/media-storage/media-image-processor.ts`

**Interface produzida:**

```ts
export interface MediaStorage {
  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
  }): Promise<{ etag: string | null }>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
```

- [ ] Instalar `@aws-sdk/client-s3`, `@fastify/multipart`, `sharp` e `file-type`.
- [ ] Criar validação Zod das variáveis R2 sem permitir inicialização de produção com secrets ausentes.
- [ ] Implementar o adapter sem expor credenciais em logs.
- [ ] Implementar detecção por assinatura binária, normalização de orientação EXIF e saída WebP.
- [ ] Testar imagem válida, MIME falso, arquivo acima do limite e imagem corrompida.
- [ ] Executar `npm run typecheck`, `npm test` e `npm run build`.

### Tarefa 2: Criar schema PostgreSQL e permissões

**Arquivos:**

- Criar: `GestaoOuvintes/api-ouvintes/database/migrations/0003_institutional_banners_r2.sql`
- Modificar: `GestaoOuvintes/api-ouvintes/src/database/schema.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/database/seed.ts`

- [ ] Escrever teste de integração que falha porque as tabelas não existem.
- [ ] Criar `media_asset` e `institutional_banner` com constraints e índices descritos na seção 3.
- [ ] Inserir as três permissões sem duplicidade e atribuí-las a `admin`.
- [ ] Atualizar o schema Drizzle e tipos inferidos.
- [ ] Rodar a migração no banco de teste e verificar com queries de integridade.
- [ ] Executar backup antes de aplicar em homologação/produção.

### Tarefa 3: Implementar upload administrativo seguro

**Arquivos:**

- Criar: `GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts`
- Criar: `GestaoOuvintes/api-ouvintes/src/schemas/institutional-banner.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/app.ts`
- Testar: `GestaoOuvintes/api-ouvintes/tests/integration/institutional-banners.test.ts`

- [ ] Registrar `@fastify/multipart` com limite de um arquivo e 10 MiB somente nessa rota.
- [ ] Exigir autenticação e permissão `media.upload`.
- [ ] Processar o stream com limite, validar magic bytes e recusar formatos não permitidos.
- [ ] Otimizar com Sharp antes do upload.
- [ ] Gerar chave UUID imutável e enviar ao R2.
- [ ] Persistir `media_asset` somente após sucesso do R2; se a persistência falhar, tentar remover o objeto compensatoriamente.
- [ ] Retornar `201` com asset e preview CDN.
- [ ] Cobrir `401`, `403`, `413`, `415`, imagem corrompida, erro R2 e sucesso.

### Tarefa 4: Implementar CRUD, ativação e ordenação

**Arquivos:**

- Criar: `GestaoOuvintes/api-ouvintes/src/services/institutional-banner-service.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/schemas/institutional-banner.ts`
- Testar: `GestaoOuvintes/api-ouvintes/tests/integration/institutional-banners.test.ts`

- [ ] Escrever testes de criação, edição, link vazio, URL inválida, ativação, desativação, reordenação e soft delete.
- [ ] Validar existência e status `ready` do asset antes de associá-lo.
- [ ] Impedir alteração/exclusão do conceito `hero-static`; ele não existe no banco e nenhuma rota deve aceitá-lo.
- [ ] Implementar reordenação transacional, renumerando sequencialmente a partir de 1.
- [ ] Marcar asset substituído como `orphaned` somente quando nenhuma outra entidade o referencia.
- [ ] Auditar todas as mutações.
- [ ] Garantir respostas `400`, `404`, `409` e `422` controladas, sem 500 para erro de negócio.

### Tarefa 5: Implementar endpoint público cacheável

**Arquivos:**

- Criar: `GestaoOuvintes/api-ouvintes/src/routes/public-institutional-banners.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/app.ts`
- Testar: `GestaoOuvintes/api-ouvintes/tests/integration/institutional-banners.test.ts`

- [ ] Escrever teste garantindo que somente ativos e `ready` são retornados na ordem correta.
- [ ] Resolver `imageUrl` com `R2_PUBLIC_BASE_URL + object_key`.
- [ ] Implementar `Cache-Control`, `ETag` e resposta `304`.
- [ ] Adicionar rate limit público moderado sem prejudicar cache/CDN.
- [ ] Validar que o retorno não expõe bucket, credenciais, IDs administrativos ou metadados internos.

### Tarefa 6: Criar módulo de banners no painel administrativo

**Arquivos:**

- Criar os componentes listados na seção 6.
- Modificar: `GestaoOuvintes/painel-adm/src/App.tsx`
- Modificar: `GestaoOuvintes/painel-adm/src/components/layout/AppShell.tsx`
- Modificar: `GestaoOuvintes/painel-adm/src/services/api.ts`
- Modificar: `GestaoOuvintes/painel-adm/src/types/api.ts`

- [ ] Criar rota protegida `/banners-institucionais` e item “Banners” no menu.
- [ ] Criar upload com preview local, progresso, cancelamento e mensagens específicas de erro.
- [ ] Exibir recomendação de proporção/dimensões antes do upload.
- [ ] Criar formulário com título, texto alternativo, imagem, link opcional, nova aba e ativo.
- [ ] Criar ordenação acessível: drag-and-drop no desktop/touch e botões “Mover para cima/baixo” como alternativa de teclado.
- [ ] Exibir um card bloqueado “Banner principal da Rádio 88 FM” na posição fixa para deixar claro que ele não é editável.
- [ ] Usar TanStack Query com invalidação após upload/CRUD/reordenação; evitar refetch em cascata.
- [ ] Criar estados loading, vazio, erro e confirmação de exclusão.
- [ ] Ocultar mutações para quem não possui permissão, mantendo enforcement obrigatório na API.
- [ ] Testar mobile em 320, 375 e 430 px; desktop em 1280 e 1440 px.

### Tarefa 7: Integrar o institucional preservando fallback

**Arquivos:**

- Criar: `radio-88-fm-institucional/src/services/institutional-banners/api.ts`
- Criar: `radio-88-fm-institucional/src/services/institutional-banners/types.ts`
- Criar: `radio-88-fm-institucional/src/hooks/useInstitutionalBanners.ts`
- Modificar: `radio-88-fm-institucional/src/pages/Index.tsx`
- Modificar: `radio-88-fm-institucional/.env.example`
- usar as duas imagens que estão sendo usadas nos banners estáticos e jogar para o R2, já criei a conta 
- EM HIPÓTESE ALGUMA, ULTRAPASSE O LIMITE GRATUITO, OU UTILIZE FERRAMENTAS DO R2 QUE NÃO É PARA SER UTILIZADA, VAMOS APENAS SUBIR IMGENS E CONSUMIR IMAGENS DO. R2 NO MODELO GRATUITO QUE ESTÁ SETAO.

Adicionar:

```env
VITE_GESTAO_OUVINTES_API_URL=http://127.0.0.1:3010
VITE_INSTITUTIONAL_BANNERS_ENABLED=true
VITE_INSTITUTIONAL_BANNERS_PLACEMENT=home_hero
```

- [ ] Escrever testes do hook para sucesso, vazio, erro, resposta atrasada e cache `304`.
- [ ] Manter o Hero branco local como `heroSlides[0]`.
- [ ] Mapear banners da API após o branco, sem permitir que dados remotos substituam esse item.
- [ ] Manter `staticHeroBanners` como fallback temporário controlado por feature flag durante homologação.
- [ ] Se a API falhar, manter banner branco e fallback; nunca deixar o Hero vazio.
- [ ] Preservar autoplay, pausa em hover/foco, setas, analytics, links e `prefers-reduced-motion`.
- [ ] Se a lista remota mudar enquanto o usuário está na página, revalidar sem reset visual abrupto do slide atual.
- [ ] Aplicar `loading="eager"` somente à imagem inicialmente visível e `loading="lazy"` às demais.
- [ ] Testar crop e proporção em mobile e desktop.

### Tarefa 8: Migrar banners e retirar responsabilidade do CMS antigo

**Arquivos:**

- Modificar: `cms-feitoamao/src/App.tsx`
- Modificar: `cms-feitoamao/src/components/cms/CMSLayout.tsx`
- Modificar: `cms-feitoamao/src/config/access-control.ts`
- Preservar temporariamente: `cms-feitoamao/src/pages/BannersInstitucionaisList.tsx`

- [ ] Inventariar banners ativos do MySQL/PortalGtf e os dois assets estáticos atuais.
- [ ] Reenviar somente os banners aprovados ao R2 pelo novo painel, preservando ordem, título e link.
- [ ] Comparar visualmente URLs antigas e novas antes da publicação.
- [ ] Retirar o item de menu e bloquear/redirecionar a rota antiga para uma tela informando que a gestão foi movida.
- [ ] Manter endpoints antigos em modo compatível durante uma janela de rollback de 14 dias, sem novas escritas pelo CMS.
- [ ] Após a janela e validação de logs, remover a dependência pública do PortalGtf; remoção definitiva de tabela/código legado deve ser tratada em plano separado.

### Tarefa 9: Deploy, observabilidade e limpeza

**Arquivos:**

- Modificar: `GestaoOuvintes/api-ouvintes/compose.yaml`
- Modificar documentação indicada na Tarefa 10.

- [ ] Configurar secrets R2 no ambiente da API e nunca no painel/institucional.
- [ ] Aplicar migração antes de subir a nova API.
- [ ] Validar permissões do token R2 com upload e delete de um objeto de teste.
- [ ] Configurar domínio CDN e verificar HTTPS, cache headers, ETag e `Content-Type`.
- [ ] Monitorar taxa de 4xx/5xx de upload e endpoint público.
- [ ] Criar rotina operacional de limpeza de assets `orphaned` com mais de 30 dias, inicialmente manual e auditada.
- [ ] Confirmar que backup PostgreSQL contém metadados e que R2 possui estratégia própria de retenção; banco e objetos devem ser recuperáveis em conjunto.

### Tarefa 10: Documentar operação e propriedade

**Arquivos:**

- Modificar: `GestaoOuvintes/docs/architecture.md`
- Modificar: `GestaoOuvintes/docs/backend-api.md`
- Modificar: `GestaoOuvintes/docs/frontend-admin.md`
- Modificar: `GestaoOuvintes/docs/database.md`
- Modificar: `GestaoOuvintes/docs/deployment-operations.md`
- Modificar: `GestaoOuvintes/docs/security-privacy.md`
- Modificar: `docs/radio-88-fm-institucional.md`
- Modificar: `docs/cms-feitoamao.md`
- Modificar: `docs/media-storage.md`

- [ ] Documentar que o Gestão de Ouvintes passa a ser proprietário dos banners institucionais.
- [ ] Documentar criação de bucket, custom domain, token mínimo e rotação de credenciais.
- [ ] Documentar formatos, tamanho, proporção e processo de substituição.
- [ ] Documentar fallback do Hero e rollback para banners estáticos.
- [ ] Documentar como restaurar banco + objetos R2 sem alterar URLs públicas.

## 8. Estratégia de cache e atualização

- Metadados da lista: cache curto de 60 segundos com revalidação.
- Imagens: cache de um ano e `immutable`, pois cada alteração gera nova chave.
- Publicação no painel: invalida o cache de consulta do painel imediatamente.
- Propagação pública esperada: até 60 segundos sem purge manual.
- Para publicação urgente, prever no futuro purge por URL via API Cloudflare, mas não incluir token de purge na primeira fase.
- O institucional deve tratar mudança de `version` sem desmontar todo o Hero ou voltar inesperadamente ao primeiro slide.

## 9. Segurança

- Validar o arquivo pelo conteúdo, não apenas extensão/MIME enviado pelo browser.
- Remover metadados EXIF no processamento.
- Gerar nomes de objetos no servidor.
- Não aceitar URL externa como imagem do banner; toda imagem deve estar em asset gerenciado.
- Validar `destination_url` para evitar `javascript:`, `data:` e protocolos inseguros.
- Adicionar `rel="noopener noreferrer"` para nova aba.
- Aplicar rate limit menor ao upload e limites independentes do `bodyLimit` global de 32 KiB.
- Não logar payload binário, secrets R2 ou URLs assinadas.
- Restringir upload/gestão à permissão, não somente à visibilidade do menu.
- Usar CSP do institucional permitindo imagens apenas do próprio site, domínio CDN e fontes já autorizadas.

## 10. Plano de testes

### API

- Upload válido de JPEG/PNG/WebP/AVIF.
- Rejeição de MIME falso, SVG, arquivo corrompido e arquivo maior que 10 MiB.
- Falha R2 sem registro órfão no banco.
- Falha PostgreSQL com compensação do objeto R2.
- CRUD autorizado e `401`/`403` para acessos indevidos.
- Reordenação transacional e concorrente.
- Endpoint público ordenado, sem inativos e com `ETag`/`304`.
- Link opcional e rejeição de protocolo inseguro.

### Painel

- Upload, preview, edição, ativação, desativação, exclusão e reordenação.
- Banner branco fixo visível e não editável.
- Feedback em rede lenta e falha de upload.
- Navegação por teclado e alternativas ao drag.
- Layout Mobile First sem overflow.

### Institucional

- Banner branco sempre na posição 0.
- Zero, um e vários banners dinâmicos.
- API offline e CDN com erro de imagem.
- Troca de ordem refletida após revalidação.
- Links na mesma/nova aba.
- Autoplay, setas, pausa, analytics e reduced motion sem regressão.
- Mobile 320/375/430 e desktop 1024/1440/1920.

## 11. Estratégia de release e rollback

1. Criar bucket e domínio CDN.
2. Aplicar migração PostgreSQL.
3. Publicar API com rotas ainda não consumidas.
4. Publicar painel e cadastrar banners de homologação.
5. Validar endpoint público e CDN.
6. Publicar institucional com feature flag desativada.
7. Ativar flag em homologação e realizar QA.
8. Ativar em produção.
9. Retirar menu/rota de escrita do CMS antigo.
10. Observar por 14 dias antes de eliminar código/tabela antigos.

Rollback imediato:

- Desativar `VITE_INSTITUTIONAL_BANNERS_ENABLED` em novo build do institucional ou usar configuração remota futura.
- O Hero volta ao banner branco + `staticHeroBanners`.
- Não apagar dados PostgreSQL nem objetos R2 durante rollback.

## 12. Critérios de aceite

- [ ] O painel Gestão de Ouvintes permite subir, visualizar, editar, ativar, desativar, excluir e ordenar banners.
- [ ] As imagens são armazenadas no R2 e servidas por custom domain/CDN em produção.
- [ ] Nenhum secret R2 aparece nos bundles React ou respostas públicas.
- [ ] O banco armazena `object_key`, não domínio absoluto.
- [ ] O banner branco permanece fixo, primeiro e não editável.
- [ ] O número de banners promocionais pode aumentar ou diminuir sem deploy do institucional.
- [ ] Links opcionais funcionam na mesma ou em nova aba.
- [ ] O institucional mantém fallback funcional quando API/CDN falha.
- [ ] Ordem alterada no painel aparece no institucional em até 60 segundos.
- [ ] Rotas administrativas exigem autenticação e permissão.
- [ ] Upload rejeita tipos/tamanhos inseguros e remove EXIF.
- [ ] CMS antigo deixa de oferecer escrita de banners após o cutover.
- [ ] Testes, lint, typecheck e builds dos três projetos passam.
- [ ] Documentação de setup, deploy, backup, segurança e rollback está atualizada.

## 13. Comandos de validação

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm test
npm run build

cd ../painel-adm
npm run lint
npm test
npm run build

cd ../../radio-88-fm-institucional
npm run lint
npm test
npm run build

cd ../cms-feitoamao
npm run lint
npm test
npm run build
```

## 14. Pontos de decisão antes da implementação

Os seguintes valores foram definidos como padrões seguros para evitar bloqueio da implementação e podem ser alterados antes da execução:

- Custom domain sugerido: `media.radio88fm.com.br`.
- Bucket sugerido: `radio88-institutional-media`.
- Formatos: JPEG, PNG, WebP e AVIF.
- Limite: 10 MiB.
- Dimensão recomendada: mínimo 1200 x 675 px.
- Cache da lista: 60 segundos.
- Retenção de órfãos: 30 dias.
- Janela de rollback do CMS antigo: 14 dias.

## 15. Referências oficiais

- [Cloudflare R2: S3-compatible API](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2: public buckets e custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2: upload de objetos](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare R2: CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare R2: presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2: lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

