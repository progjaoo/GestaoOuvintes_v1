# Correção do Upload R2 e Ordenação dos Banners Institucionais

> **Para agentes de implementação:** usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar este plano tarefa por tarefa. Cada etapa usa checkbox para acompanhamento.

**Objetivo:** corrigir o fluxo de criação de banners institucionais para que imagens válidas sejam processadas pela `api-ouvintes`, armazenadas no Cloudflare R2, registradas no PostgreSQL e exibidas no final do carrossel do site institucional.

**Arquitetura:** manter o upload mediado pela API. O `painel-adm` envia um único arquivo em `multipart/form-data`; a API detecta o tipo pelos bytes, converte a imagem para WebP, envia o objeto ao R2 pelo endpoint S3 e persiste `media_asset` somente após a confirmação do upload. A criação do banner referencia esse asset e calcula a última posição de forma transacional por `placement_key`; o institucional continua consumindo somente o endpoint público ordenado.

**Stack:** Node.js 24, TypeScript, Fastify 5, `@fastify/multipart`, Sharp, AWS SDK v3, Cloudflare R2, PostgreSQL 16, Drizzle ORM, React 18, TanStack React Query, Vite e Vitest.

ALERTA: PRESTA ATENÇÃO NESSE COMANDO. NO FINAL DA EXECUÇÃO DO PLANO, DEIXE AS INSTRUÇÕES PARA RODAR A APLICAÇÃO NÃO PRECISA VOCÊ FICAR RODANDO COMANDOS PARA STARTAR A APLICAÇÃO, NO FINAL DO @setup-local.md em docs dentro da pasta GESTAOOUVINTES, deixe a instrução para rodar a api-ouvintes e o painel-adm localmente 

## Agentes responsáveis

- **Tech Lead / Arquiteto (responsável principal):** coordenar o contrato entre painel, API, R2, PostgreSQL e institucional.
- **Backend API Engineer:** diagnosticar o `422`, ajustar processamento, storage, erros HTTP e ordenação transacional.
- **Security Engineer:** revisar MIME real, tamanho, permissões R2, secrets, object keys e mensagens de erro.
- **DevOps / Release Engineer:** validar variáveis por ambiente, bucket, endpoint S3, URL pública e processo único na porta `3010`.
- **QA Engineer:** automatizar upload, falhas de storage, append da ordem, reordenação e contrato público.
- **Institutional Frontend Engineer:** validar consumo ordenado e fallback local sem modificar o banner branco fixo.
- **CMS Frontend Engineer:** melhorar validações e feedback do formulário no `painel-adm`.

## Restrições globais

- Não alterar módulos de campanhas, ouvintes, autenticação ou exportação.
- Não expor `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` ou `R2_ACCOUNT_ID` em variáveis `VITE_*`.
- Não fazer upload direto do navegador ao R2 nesta fase; portanto, CORS do bucket não participa do `PUT` administrativo.
- O campo multipart deve continuar chamado `file`.
- Tipos aceitos: JPEG, PNG, WebP e AVIF, detectados pelos bytes; SVG não será aceito pelo upload do painel.
- Tamanho máximo: `INSTITUTIONAL_BANNER_MAX_BYTES`, atualmente 10 MiB.
- O objeto final será WebP, com chave imutável sob `R2_OBJECT_PREFIX`.
- Persistir somente `object_key`; a URL pública é resolvida por `R2_PUBLIC_BASE_URL`.
- O banner branco principal permanece local, fixo e fora da gestão administrativa.
- Um banner novo deve receber a última ordem do seu `placement_key`; o painel não enviará `displayOrder` na criação.
- Banners públicos devem ser ativos, não excluídos, com asset `ready`, ordenados por `display_order` e `created_at`.
- Não registrar secrets, token JWT ou bytes da imagem em logs.

---

## 1. Diagnóstico confirmado no código atual

O erro mudou de `404` para `422`, portanto a rota abaixo está registrada e sendo alcançada:

```text
POST /api/admin/institutional-banners/assets
```

O fluxo atual é:

```text
InstitutionalBannersPage
  -> api.uploadInstitutionalBannerAsset(file)
  -> FormData com field `file`
  -> Fastify request.file()
  -> processBannerImage(buffer, filename)
  -> R2MediaStorage.put(...)
  -> INSERT media_asset(status = ready)
  -> POST /api/admin/institutional-banners
  -> INSERT institutional_banner
```

O único `422` diretamente produzido no upload de asset é:

```text
INVALID_IMAGE: Nao foi possivel processar a imagem.
```

Ele nasce em `media-image-processor.ts`, onde qualquer erro ocorrido após a detecção do MIME é capturado e convertido na mesma mensagem. Isso oculta se a falha ocorreu em metadata, rotação, resize ou codificação WebP. Falhas R2, por outro lado, ainda não são normalizadas e tendem a virar `500` genérico.

A ordenação de criação já tenta usar `(maior display_order ?? 0) + 1`, mas não há teste específico nem proteção contra duas criações simultâneas no mesmo placement. O plano preserva essa regra e elimina a condição de corrida.

## 2. Decisão de solução

### Alternativas consideradas

1. **Upload direto do navegador ao R2:** exigiria URL pré-assinada, CORS com `PUT` e confirmação pós-upload. É desnecessário para banners de até 10 MiB e amplia a superfície de segurança.
2. **Salvar localmente em desenvolvimento e usar R2 somente em produção:** facilitaria testes isolados, mas deixaria o fluxo local diferente daquele que precisa ser homologado agora.
3. **Upload mediado pela API para o R2 em desenvolvimento e produção:** preserva credenciais no backend, permite validação real dos bytes e testa o mesmo caminho S3 dos ambientes publicados. **Recomendado e mantido.**

### Fluxo final esperado

```text
Painel administrativo
  -> valida formato/tamanho localmente
  -> POST multipart /assets
API
  -> valida multipart e MIME real
  -> converte para WebP
  -> PUT R2 com ContentLength, ContentType e CacheControl
  -> registra media_asset ready
  -> retorna mediaAssetId + imageUrl
Painel
  -> POST /institutional-banners com mediaAssetId
API
  -> bloqueia a ordem do placement
  -> calcula MAX(display_order) + 1
  -> cria banner na última posição
Institucional
  -> GET público
  -> banner branco local + banners ativos ordenados
```

## 3. Hipóteses que a implementação deve provar antes de corrigir

- **H1:** o response body do `422` contém `code = INVALID_IMAGE`; se não contiver, interromper a alteração no Sharp e rastrear o código efetivamente retornado.
- **H2:** o arquivo selecionado possui MIME permitido e bytes íntegros; extensão do nome não será tomada como prova.
- **H3:** o processo da API carregou `MEDIA_STORAGE_DRIVER=r2` e todas as variáveis R2 no mesmo shell/container em execução.
- **H4:** há apenas um processo atendendo `127.0.0.1:3010`; uma imagem Docker antiga não pode concorrer com o servidor `tsx watch`.
- **H5:** as credenciais têm Object Read & Write restrito ao bucket `site-institucional`, e `R2_BUCKET_NAME` corresponde exatamente ao bucket real.
- **H6:** `R2_PUBLIC_BASE_URL` abre objetos no prefixo `banners-institucional` e não aponta para o endpoint privado `r2.cloudflarestorage.com`.

Nenhuma correção de processamento deve ser implementada até o código, a mensagem e o log estruturado confirmarem a hipótese da fronteira que falhou.

---

### Tarefa 1: Criar diagnóstico reproduzível do fluxo local

**Arquivos:**

- Criar: `GestaoOuvintes/api-ouvintes/scripts/check-r2.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/package.json`
- Modificar: `GestaoOuvintes/api-ouvintes/src/app.ts`
- Modificar: `GestaoOuvintes/docs/setup-local.md`

**Interfaces:**

- Produz: comando `npm run r2:check` que valida configuração, grava um objeto temporário, consulta o objeto e o remove.
- Produz: logs estruturados da API contendo `requestId`, `errorCode`, etapa e metadados não sensíveis.

- [ ] **Passo 1: registrar a reprodução exata antes da mudança**

No DevTools, abrir a requisição `/assets` e guardar status e JSON de resposta. O resultado esperado para a hipótese atual é:

```json
{
  "statusCode": 422,
  "code": "INVALID_IMAGE",
  "message": "Nao foi possivel processar a imagem."
}
```

Registrar também tipo e tamanho do arquivo, sem registrar seu conteúdo.

- [ ] **Passo 2: garantir um único processo na porta da API**

Executar:

```bash
lsof -nP -iTCP:3010 -sTCP:LISTEN
docker ps --format '{{.Names}} {{.Ports}}'
```

Esperado: somente o processo escolhido para desenvolvimento atende `127.0.0.1:3010`. Se o container antigo estiver ativo, pará-lo antes do teste local ou reconstruí-lo com o código atual.

- [ ] **Passo 3: adicionar um verificador R2 sem imprimir secrets**

O script deve:

```ts
const key = `${env.R2_OBJECT_PREFIX}/health/${crypto.randomUUID()}.txt`;
await client.send(new PutObjectCommand({
  Bucket: env.R2_BUCKET_NAME,
  Key: key,
  Body: Buffer.from("radio88-r2-check"),
  ContentLength: 16,
  ContentType: "text/plain",
}));
await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
```

O resultado deve exibir apenas bucket, prefixo e sucesso/falha normalizada. Nunca exibir access key, secret ou JWT.

- [ ] **Passo 4: adicionar o comando operacional**

Em `package.json`:

```json
"r2:check": "tsx scripts/check-r2.ts"
```

- [ ] **Passo 5: documentar a configuração de desenvolvimento**

Documentar:

```env
MEDIA_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET_NAME=site-institucional
R2_PUBLIC_BASE_URL=https://<public-id>.r2.dev
R2_OBJECT_PREFIX=banners-institucional
```

Explicar que o endpoint S3 é derivado do Account ID pela API e que a URL pública `r2.dev` não substitui o endpoint S3 de escrita.

- [ ] **Passo 6: executar o diagnóstico**

```bash
cd GestaoOuvintes/api-ouvintes
npm run r2:check
```

Esperado: `R2 check completed` e nenhum objeto residual sob `banners-institucional/health/`.

- [ ] **Passo 7: commit de diagnóstico**

```bash
git add GestaoOuvintes/api-ouvintes/scripts/check-r2.ts GestaoOuvintes/api-ouvintes/package.json GestaoOuvintes/api-ouvintes/src/app.ts GestaoOuvintes/docs/setup-local.md
git commit -m "chore: add R2 banner diagnostics"
```

### Tarefa 2: Tornar o processamento de imagens testável e diagnosticável

**Arquivos:**

- Modificar: `GestaoOuvintes/api-ouvintes/src/services/media-storage/media-image-processor.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/tests/unit/media-image-processor.test.ts`
- Criar: `GestaoOuvintes/api-ouvintes/tests/fixtures/banners/README.md`

**Interfaces:**

- Consome: `processBannerImage(input: Buffer, originalName: string)`.
- Produz: erros públicos estáveis `INVALID_IMAGE_TYPE`, `INVALID_IMAGE` e `IMAGE_TOO_LARGE`, com causa técnica apenas no log interno.

- [ ] **Passo 1: escrever testes que reproduzem entradas reais**

Cobrir:

```ts
it.each([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
])("processa %s para WebP", async (format) => {
  const input = await createFixtureBuffer(format);
  const result = await processBannerImage(input, `banner.${format}`);
  expect(result.mimeType).toBe("image/webp");
  expect(result.buffer.length).toBeGreaterThan(0);
});
```

Adicionar casos para bytes corrompidos, arquivo renomeado com extensão falsa, dimensão acima do limite de pixels e buffer vazio.

- [ ] **Passo 2: executar os testes e confirmar a cobertura anterior ao ajuste**

```bash
cd GestaoOuvintes/api-ouvintes
npm test -- tests/unit/media-image-processor.test.ts
```

Esperado: o caso equivalente ao arquivo que gerou o `422` reproduz `INVALID_IMAGE` antes da correção.

- [ ] **Passo 3: separar detecção, leitura de metadata e transformação**

Manter a resposta pública segura, mas preservar a causa no erro:

```ts
try {
  // metadata + rotate + resize + webp
} catch (cause) {
  throw new AppError(
    422,
    "INVALID_IMAGE",
    "Nao foi possivel processar a imagem.",
    { stage: "image_processing" },
    { cause },
  );
}
```

Se `AppError` não aceitar `cause`, ampliar sua assinatura sem serializar `cause` na resposta. O handler deve registrar `cause` com `request.log.error`, mantendo o cliente apenas com `code`, `message` e `requestId`.

- [ ] **Passo 4: mapear erros do multipart explicitamente**

Converter limite e ausência de arquivo para contratos previsíveis:

```text
400 FILE_REQUIRED
413 IMAGE_TOO_LARGE
415 INVALID_IMAGE_TYPE
422 INVALID_IMAGE
```

- [ ] **Passo 5: executar os testes unitários**

```bash
npm test -- tests/unit/media-image-processor.test.ts
```

Esperado: todos os formatos permitidos passam e entradas inválidas retornam o código correto.

- [ ] **Passo 6: commit do processador**

```bash
git add GestaoOuvintes/api-ouvintes/src/services/media-storage/media-image-processor.ts GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts GestaoOuvintes/api-ouvintes/tests/unit/media-image-processor.test.ts GestaoOuvintes/api-ouvintes/tests/fixtures/banners/README.md
git commit -m "fix: make banner image processing reliable"
```

### Tarefa 3: Normalizar falhas e garantir consistência no adapter R2

**Arquivos:**

- Modificar: `GestaoOuvintes/api-ouvintes/src/services/media-storage/r2-media-storage.ts`
- Modificar: `GestaoOuvintes/api-ouvintes/src/services/institutional-banner-service.ts`
- Criar: `GestaoOuvintes/api-ouvintes/tests/unit/r2-media-storage.test.ts`
- Criar: `GestaoOuvintes/api-ouvintes/tests/unit/institutional-banner-upload.test.ts`

**Interfaces:**

- Produz: `R2_UPLOAD_FAILED` (`502`), `R2_DELETE_FAILED` apenas em log/limpeza e `MEDIA_STORAGE_NOT_CONFIGURED` (`503`).
- Preserva: `MediaStorage.put()` com `ContentLength` conhecido, `region: "auto"` e endpoint `https://<account>.r2.cloudflarestorage.com`.

- [ ] **Passo 1: criar testes com storage falso**

Validar três cenários:

```ts
const storage = {
  put: vi.fn().mockResolvedValue({ etag: "etag-1" }),
  delete: vi.fn().mockResolvedValue(undefined),
  publicUrl: vi.fn((key) => `https://cdn.test/${key}`),
};
```

- upload bem-sucedido grava `media_asset` somente depois de `put`;
- falha do `put` não grava asset;
- falha do banco após `put` tenta remover o objeto recém-criado.

- [ ] **Passo 2: encapsular erros do AWS SDK sem mascarar erros de domínio**

```ts
try {
  const result = await this.client.send(new PutObjectCommand({...}));
  return { etag: result.ETag?.replaceAll('"', "") ?? null };
} catch (cause) {
  throw new AppError(502, "R2_UPLOAD_FAILED", "Nao foi possivel armazenar a imagem.", {
    provider: "r2",
  });
}
```

O log interno deve incluir nome/classe do erro AWS e `$metadata.requestId`, mas nunca as credenciais.

- [ ] **Passo 3: validar URL pública independentemente da escrita**

Após o upload de teste, executar `HEAD` ou `GET` na URL gerada e confirmar `200`, `Content-Type` e cache. A API não deve usar a URL pública para escrever.

- [ ] **Passo 4: executar testes do storage**

```bash
npm test -- tests/unit/r2-media-storage.test.ts tests/unit/institutional-banner-upload.test.ts
```

Esperado: todos passam sem realizar chamada real ao R2.

- [ ] **Passo 5: commit do adapter**

```bash
git add GestaoOuvintes/api-ouvintes/src/services/media-storage/r2-media-storage.ts GestaoOuvintes/api-ouvintes/src/services/institutional-banner-service.ts GestaoOuvintes/api-ouvintes/tests/unit/r2-media-storage.test.ts GestaoOuvintes/api-ouvintes/tests/unit/institutional-banner-upload.test.ts
git commit -m "fix: normalize R2 banner storage failures"
```

### Tarefa 4: Garantir criação na última ordem sem condição de corrida

**Arquivos:**

- Modificar: `GestaoOuvintes/api-ouvintes/src/services/institutional-banner-service.ts`
- Criar: `GestaoOuvintes/api-ouvintes/tests/integration/institutional-banners.test.ts`

**Interfaces:**

- Consome: `createInstitutionalBanner(input, adminUserId)`.
- Produz: `displayOrder = maior ordem ativa ou inativa não excluída do placement + 1`.
- Preserva: `PUT /reorder` como mecanismo explícito de alteração posterior.

- [ ] **Passo 1: escrever o teste de append**

Criar dois banners existentes com ordens `1` e `4`; criar um terceiro e verificar:

```ts
expect(created.displayOrder).toBe(5);
```

Criar também um banner em outro placement e confirmar que sua ordem começa em `1`.

- [ ] **Passo 2: escrever teste concorrente**

Executar duas criações simultâneas no mesmo placement e exigir ordens diferentes e consecutivas:

```ts
const [first, second] = await Promise.all([
  createBanner("A"),
  createBanner("B"),
]);
expect(new Set([first.displayOrder, second.displayOrder]).size).toBe(2);
```

- [ ] **Passo 3: proteger o cálculo dentro da transação**

Adquirir um lock transacional por placement antes do `MAX + 1`:

```ts
await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`institutional_banner:${input.placementKey}`}))`);
```

Em seguida, consultar a maior ordem dos banners não excluídos e inserir `last + 1` na mesma transação. O lock é liberado automaticamente no commit/rollback.

- [ ] **Passo 4: retornar o banner serializado após criação**

O `POST /api/admin/institutional-banners` deve retornar `displayOrder`, `imageUrl` e metadados no mesmo formato de listagem, evitando depender de um refresh para descobrir a ordem.

- [ ] **Passo 5: executar integração**

```bash
RUN_INTEGRATION_TESTS=true npm test -- tests/integration/institutional-banners.test.ts
```

Esperado: append simples, placements independentes e criação concorrente passam.

- [ ] **Passo 6: commit da ordenação**

```bash
git add GestaoOuvintes/api-ouvintes/src/services/institutional-banner-service.ts GestaoOuvintes/api-ouvintes/tests/integration/institutional-banners.test.ts
git commit -m "fix: append institutional banners atomically"
```

### Tarefa 5: Melhorar validação e feedback no painel administrativo

**Arquivos:**

- Modificar: `GestaoOuvintes/painel-adm/src/pages/InstitutionalBannersPage.tsx`
- Modificar: `GestaoOuvintes/painel-adm/src/services/api.ts`
- Modificar: `GestaoOuvintes/painel-adm/src/types/api.ts`
- Criar: `GestaoOuvintes/painel-adm/src/pages/InstitutionalBannersPage.test.tsx`

**Interfaces:**

- Consome: códigos HTTP da API e `InstitutionalBannerAsset`.
- Produz: feedback distinto para formato, tamanho, processamento, configuração e indisponibilidade R2.

- [ ] **Passo 1: escrever testes do formulário**

Cobrir:

- arquivo não selecionado;
- tipo não permitido;
- arquivo maior que o limite;
- `422 INVALID_IMAGE`;
- `502 R2_UPLOAD_FAILED`;
- sucesso em duas etapas (`/assets` e depois `/institutional-banners`);
- novo item exibido por último após invalidar a query.

- [ ] **Passo 2: validar antes do envio**

```ts
const ALLOWED_BANNER_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const MAX_BANNER_BYTES = 10 * 1024 * 1024;
```

Essa validação melhora UX, mas não substitui a validação por bytes da API.

- [ ] **Passo 3: preservar o erro retornado pela API**

Mapear mensagens úteis:

```text
INVALID_IMAGE_TYPE -> Selecione JPEG, PNG, WebP ou AVIF.
INVALID_IMAGE -> A imagem está corrompida ou não pôde ser processada.
IMAGE_TOO_LARGE -> A imagem ultrapassa 10 MiB.
MEDIA_STORAGE_NOT_CONFIGURED -> O armazenamento R2 não está configurado neste ambiente.
R2_UPLOAD_FAILED -> O R2 não recebeu a imagem. Tente novamente.
```

- [ ] **Passo 4: indicar a ordem automática**

Adicionar ao modal uma nota não editável:

```text
O novo banner será adicionado ao final. Depois você poderá alterar a ordem na listagem.
```

Não adicionar campo manual de ordem ao cadastro.

- [ ] **Passo 5: evitar asset órfão quando a segunda etapa falhar**

Planejar endpoint transacional único `POST /api/admin/institutional-banners/with-asset` somente se os testes mostrarem órfãos recorrentes. Nesta correção, manter as duas etapas e marcar o asset como `orphaned` em uma rota de compensação ou job de limpeza quando a criação do banner falhar após upload bem-sucedido.

- [ ] **Passo 6: executar os testes do painel**

```bash
cd GestaoOuvintes/painel-adm
npm test -- src/pages/InstitutionalBannersPage.test.tsx
npm run build
```

Esperado: testes e build passam.

- [ ] **Passo 7: commit do painel**

```bash
git add GestaoOuvintes/painel-adm/src/pages/InstitutionalBannersPage.tsx GestaoOuvintes/painel-adm/src/services/api.ts GestaoOuvintes/painel-adm/src/types/api.ts GestaoOuvintes/painel-adm/src/pages/InstitutionalBannersPage.test.tsx
git commit -m "fix: improve institutional banner upload feedback"
```

### Tarefa 6: Validar contrato público e ordem no site institucional

**Arquivos:**

- Modificar: `radio-88-fm-institucional/src/services/institutional-banners/api.test.ts`
- Modificar: `radio-88-fm-institucional/src/hooks/useInstitutionalBanners.ts`
- Modificar somente se necessário: `radio-88-fm-institucional/src/pages/Index.tsx`

**Interfaces:**

- Consome: `GET /api/public/institutional-banners?placement=home_hero`.
- Preserva: slide branco local como primeiro slide e fallback local quando API/CDN falhar.

- [ ] **Passo 1: escrever teste de ordenação do contrato**

Mockar resposta com ordens `3`, `1`, `2` e garantir normalização defensiva:

```ts
const ordered = response.items.toSorted((a, b) => a.order - b.order);
expect(ordered.map((item) => item.order)).toEqual([1, 2, 3]);
```

A API continuará sendo a fonte primária da ordem; o sort no cliente atua somente como defesa.

- [ ] **Passo 2: confirmar composição do Hero**

```text
1. hero-static (banner branco local)
2. banner dinâmico order=1
3. banner dinâmico order=2
4. fallback local somente quando não houver banners válidos da API
```

- [ ] **Passo 3: validar carregamento real da imagem R2**

Abrir a URL de `imageUrl` retornada pela API e confirmar `200`. Testar o Hero em `localhost:8080` e em um dispositivo da rede local.

- [ ] **Passo 4: executar testes e build**

```bash
cd radio-88-fm-institucional
npm test -- src/services/institutional-banners/api.test.ts
npm run build
```

- [ ] **Passo 5: commit do contrato público**

```bash
git add radio-88-fm-institucional/src/services/institutional-banners/api.test.ts radio-88-fm-institucional/src/hooks/useInstitutionalBanners.ts radio-88-fm-institucional/src/pages/Index.tsx
git commit -m "test: verify ordered institutional banners"
```

### Tarefa 7: Documentar, executar QA ponta a ponta e preparar rollback

**Arquivos:**

- Modificar: `GestaoOuvintes/docs/setup-local.md`
- Modificar: `GestaoOuvintes/docs/api.md`
- Modificar: `GestaoOuvintes/docs/deploy.md`
- Modificar: `GestaoOuvintes/api-ouvintes/.env.example`
- Modificar: `GestaoOuvintes/api-ouvintes/compose.yaml`

- [ ] **Passo 1: alinhar variáveis no host e no Docker Compose**

Garantir que o serviço `api` receba as mesmas variáveis R2 do `.env` sem gravar valores no repositório. Reconstruir o container quando o fluxo Docker for usado:

```bash
docker compose up -d --build api
```

- [ ] **Passo 2: executar a matriz de QA**

| Cenário | Resultado esperado |
| --- | --- |
| PNG válido | `201`, WebP no R2, asset `ready` |
| JPEG válido | `201`, WebP no R2 |
| WebP válido | `201` |
| AVIF válido | `201` ou erro suportado documentado pelo runtime Sharp |
| SVG/HTML renomeado | `415 INVALID_IMAGE_TYPE` |
| Arquivo corrompido | `422 INVALID_IMAGE` |
| Arquivo > 10 MiB | `413 IMAGE_TOO_LARGE` |
| Credencial R2 inválida | `502 R2_UPLOAD_FAILED`, sem asset no banco |
| Driver desabilitado | `503 MEDIA_STORAGE_NOT_CONFIGURED` |
| Criação de banner | aparece no final da lista |
| Duas criações simultâneas | ordens distintas e consecutivas |
| Publicação | aparece no endpoint público |
| Reordenação | painel e institucional refletem a nova ordem |
| API pública indisponível | institucional usa fallback local |

- [ ] **Passo 3: validar CORS conforme a arquitetura real**

Como o upload é `painel -> api -> R2`, o bucket não precisa autorizar `PUT` do navegador. Para imagens públicas, usar somente `GET` e `HEAD` para os domínios de desenvolvimento e produção se a política for necessária:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "https://<dominio-institucional>"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- [ ] **Passo 4: executar verificação final**

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm test
npm run build
npm run r2:check

cd ../painel-adm
npm test
npm run build

cd ../../radio-88-fm-institucional
npm test
npm run build
```

- [ ] **Passo 5: registrar rollback**

Em caso de falha pública, manter os banners locais do institucional como fallback e desativar banners dinâmicos pelo painel. Não remover objetos do R2 nem registros do banco durante rollback emergencial.

- [ ] **Passo 6: commit da documentação**

```bash
git add GestaoOuvintes/docs GestaoOuvintes/api-ouvintes/.env.example GestaoOuvintes/api-ouvintes/compose.yaml
git commit -m "docs: add R2 banner operations and QA"
```

---

## 4. Critérios de aceite

- [ ] O response body do erro original foi identificado e registrado antes da correção.
- [ ] `npm run r2:check` comprova escrita, leitura de metadata e exclusão no bucket configurado.
- [ ] Upload de JPEG, PNG, WebP e AVIF válidos retorna `201` e cria um WebP sob `banners-institucional/YYYY/MM/`.
- [ ] O PostgreSQL registra `media_asset` apenas depois do sucesso no R2.
- [ ] Falha R2 não deixa asset `ready` no banco.
- [ ] O painel apresenta mensagens distintas para arquivo inválido, tamanho, storage não configurado e falha R2.
- [ ] Nenhum secret R2 aparece no bundle Vite, response HTTP ou logs.
- [ ] Criar banner sem informar ordem adiciona-o automaticamente ao final do placement `home_hero`.
- [ ] Criações concorrentes não recebem a mesma ordem.
- [ ] Reordenação posterior continua funcionando no painel.
- [ ] Endpoint público retorna somente banners ativos e ordenados.
- [ ] O banner branco local permanece primeiro e imutável.
- [ ] O institucional mantém fallback quando API ou CDN estiver indisponível.
- [ ] Typecheck, testes e builds das três aplicações passam.

## 5. Riscos e mitigação

- **Sharp varia por runtime/arquitetura:** cobrir formatos no mesmo Node/Docker usado pela API e registrar a causa interna de processamento.
- **R2 `r2.dev` tem limitação de taxa:** aceitável apenas para homologação; migrar `R2_PUBLIC_BASE_URL` para domínio próprio antes da produção.
- **Credencial com escopo incorreto:** usar token R2 Object Read & Write restrito ao bucket, nunca token global.
- **Asset órfão entre as duas requisições:** registrar limpeza compensatória e considerar endpoint atômico apenas se os testes demonstrarem recorrência.
- **Cache de URL antiga:** cada upload usa UUID novo e `Cache-Control: immutable`, evitando invalidação manual.
- **Condição de corrida na ordem:** serializar a escolha de `MAX + 1` com advisory lock transacional por placement.
- **Processo Docker desatualizado:** confirmar o listener da porta antes de cada homologação e reconstruir a imagem quando necessário.

## 6. Evidências obrigatórias na implementação

- JSON do `422` original com `code` e `requestId`.
- Saída sanitizada de `npm run r2:check`.
- Object key e status `ready` no PostgreSQL, sem domínio salvo.
- URL pública da imagem respondendo `200`.
- Lista administrativa mostrando o novo banner na última posição.
- Endpoint público mostrando a mesma ordem.
- Captura do Hero com o banner branco fixo e o banner recém-publicado.
- Resultado dos testes, typecheck e builds.

