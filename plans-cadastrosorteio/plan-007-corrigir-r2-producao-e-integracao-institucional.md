# Corrigir R2 em Producao e Integracao Institucional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o upload de banners institucionais para Cloudflare R2 em producao e garantir que o site institucional consuma corretamente banners e modal de cadastro da GestaoOuvintes.

**Architecture:** O painel `painel-adm` nunca grava diretamente no R2; ele envia `multipart/form-data` para a `api-ouvintes`, que valida permissao, processa a imagem com `sharp`, grava no R2 via S3 API, persiste metadados no Neon PostgreSQL e expoe banners pelo endpoint publico. O `radio-88-fm-institucional` consome somente endpoints publicos da `api-ouvintes`, mantendo fallback local para banners e abertura controlada do modal por campanha/dispositivo.

**Tech Stack:** Node.js 24, TypeScript, Fastify, @fastify/multipart, sharp, AWS SDK S3 Client, Cloudflare R2, Neon PostgreSQL, Drizzle ORM, React 18, Vite, TanStack Query, Vercel.

## Global Constraints

- Nao expor `R2_SECRET_ACCESS_KEY`, `DATABASE_URL`, JWT ou tokens em logs, docs ou variaveis `VITE_*`.
- O upload oficial de banner deve continuar passando pela API, nao pelo browser direto no R2.
- O banner branco principal do Hero institucional continua fixo/local e nao entra na gestao administrativa.
- Banners ativos do R2 devem entrar apos o banner branco, respeitando `displayOrder` crescente.
- O institucional deve manter fallback para `banner001.svg` e `banner002.svg` quando a API falhar ou retornar lista vazia.
- O modal de cadastro deve depender da campanha publicada em `institutional_modal` e reconhecer dispositivo via token local.
- Todo ajuste deve ser testado em local e em producao Vercel antes de considerar finalizado.

---

## Agentes Recomendados

- **DevOps / Release Engineer:** validar Vercel, envs de producao, logs de Function, deploy e rollback.
- **Backend API Engineer:** corrigir endpoint `/api/admin/institutional-banners/assets`, tratamento de erro, R2 adapter e persistencia.
- **Security Engineer:** revisar secrets, CORS, permissao `media.upload`, sanitizacao de upload e exposicao publica do R2.
- **Institutional Frontend Engineer:** validar consumo dos banners e modal no `radio-88-fm-institucional`.
- **QA Engineer:** executar matriz de testes local/producao, upload real, fallback, modal e regressao.
- **Documentation Engineer:** atualizar docs de R2, deploy e setup apos a correcao.

## Estado Atual Validado

- `GET https://gestaoouvintes88fm-api.vercel.app/api/public/institutional-banners?placement=home_hero` retorna `200` com `{"version":0,"items":[]}`.
- `GET https://gestaoouvintes88fm-api.vercel.app/api/public/placements/institutional_modal/campaign` retorna `200`.
- O painel consegue autenticar com admin, mas `POST /api/admin/institutional-banners/assets` retorna `502 Bad Gateway`.
- `502` nessa rota indica erro de runtime na funcao Vercel ou erro nao tratado durante multipart/processamento/upload R2.
- A documentacao atual confirma que a variavel correta do bucket e `R2_BUCKET_NAME`, nao `R2_BUCKET`.
- O institucional usa `VITE_GESTAO_OUVINTES_API_URL` para banners, mas o modal usa `VITE_LISTENER_REGISTRATION_API_URL`; ambas precisam apontar para a API publicada.

## Arquivos Envolvidos

### API GestaoOuvintes

- Modify: `GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts`
- Modify: `GestaoOuvintes/api-ouvintes/src/services/institutional-banner-service.ts`
- Modify: `GestaoOuvintes/api-ouvintes/src/services/media-storage/r2-media-storage.ts`
- Modify: `GestaoOuvintes/api-ouvintes/src/services/media-storage/media-image-processor.ts`
- Modify: `GestaoOuvintes/api-ouvintes/src/config/env.ts`
- Review: `GestaoOuvintes/api-ouvintes/scripts/check-r2.ts`
- Review: `GestaoOuvintes/api-ouvintes/vercel.json`

### Painel Administrativo

- Modify: `GestaoOuvintes/painel-adm/src/pages/InstitutionalBannersPage.tsx`
- Modify: `GestaoOuvintes/painel-adm/src/services/api.ts`
- Review: `GestaoOuvintes/painel-adm/src/features/institutional-banners/banner-file.ts`
- Review: `GestaoOuvintes/painel-adm/vercel.json`

### Site Institucional

- Modify: `radio-88-fm-institucional/src/services/institutional-banners/api.ts`
- Modify: `radio-88-fm-institucional/src/hooks/useInstitutionalBanners.ts`
- Modify: `radio-88-fm-institucional/src/services/listener-registration/api.ts`
- Modify: `radio-88-fm-institucional/.env.example`
- Review: `radio-88-fm-institucional/src/pages/Index.tsx`
- Review: `radio-88-fm-institucional/src/components/listener-registration/ListenerRegistrationModal.tsx`
- Test: `radio-88-fm-institucional/src/services/institutional-banners/api.test.ts`
- Test: `radio-88-fm-institucional/src/hooks/useListenerRegistrationCampaign.test.tsx`

## Task 1: Diagnostico de Producao do Upload R2

**Files:**
- Review: Vercel project `gestaoouvintes88fm-api`
- Review: `GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts`
- Review: `GestaoOuvintes/api-ouvintes/src/services/media-storage/r2-media-storage.ts`

**Interfaces:**
- Consumes: Vercel Function logs for `POST /api/admin/institutional-banners/assets`
- Produces: causa raiz documentada antes de mudar codigo

- [ ] **Step 1: Reproduzir o erro pelo painel em producao**

Abrir o painel publicado, autenticar como admin, enviar uma imagem JPEG/PNG/WebP/AVIF menor que 10 MiB e anotar horario exato do erro.

- [ ] **Step 2: Buscar logs da API no Vercel**

Usar Vercel Dashboard ou MCP/CLI para abrir logs do projeto `gestaoouvintes88fm-api` no minuto do erro.

Procurar por:

```text
MEDIA_STORAGE_NOT_CONFIGURED
R2_UPLOAD_FAILED
INVALID_IMAGE
Request body too large
Function invocation timed out
sharp
S3ServiceException
SignatureDoesNotMatch
AccessDenied
NoSuchBucket
```

- [ ] **Step 3: Validar envs exatas da API em Production**

Conferir no projeto `gestaoouvintes88fm-api`:

```env
MEDIA_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET_NAME=site-institucional
R2_PUBLIC_BASE_URL=<r2-dev-ou-subdominio-publico-sem-barra-final>
R2_OBJECT_PREFIX=banners-institucional
INSTITUTIONAL_BANNER_MAX_BYTES=10485760
```

Nao usar:

```env
R2_BUCKET=site-institucional
R2_BANNERS_PREFIX=banners-institucional
```

Esses nomes nao sao lidos por `src/config/env.ts`.

- [ ] **Step 4: Validar endpoint publico apos envs**

Run:

```bash
curl -i 'https://gestaoouvintes88fm-api.vercel.app/api/public/institutional-banners?placement=home_hero'
```

Expected:

```text
HTTP/2 200
{"version":0,"items":[]}
```

Esse teste confirma API e banco, mas nao valida escrita no R2.

## Task 2: Criar Diagnostico Operacional R2 em Producao

**Files:**
- Modify: `GestaoOuvintes/api-ouvintes/src/routes/admin-institutional-banners.ts`
- Modify: `GestaoOuvintes/api-ouvintes/src/services/media-storage/r2-media-storage.ts`
- Test: `GestaoOuvintes/api-ouvintes/tests` ou teste de rota existente

**Interfaces:**
- Consumes: `createMediaStorage()`, `uploadInstitutionalBannerAsset(...)`
- Produces: erros HTTP controlados em vez de `502` generico

- [ ] **Step 1: Envolver upload em tratamento explicito de erro**

No endpoint `POST /assets`, manter `AppError` como erro controlado e logar apenas metadados seguros:

```ts
app.log.error({
  code: error instanceof AppError ? error.code : "UNEXPECTED_UPLOAD_ERROR",
  filename: part.filename,
  contentType: part.mimetype,
}, "Falha no upload de banner institucional");
```

Nao logar buffer, token, headers de autorizacao ou secrets.

- [ ] **Step 2: Garantir resposta JSON controlada**

Se a causa for R2/configuracao, o cliente deve receber:

```json
{
  "statusCode": 502,
  "code": "R2_UPLOAD_FAILED",
  "message": "Nao foi possivel armazenar a imagem."
}
```

Se faltar env:

```json
{
  "statusCode": 503,
  "code": "MEDIA_STORAGE_NOT_CONFIGURED",
  "message": "O armazenamento de midias ainda nao foi configurado."
}
```

- [ ] **Step 3: Adicionar check administrativo opcional**

Criar `GET /api/admin/institutional-banners/storage/check` protegido por `media.upload` para executar um teste leve de configuracao sem enviar arquivo do usuario.

Resposta esperada quando configurado:

```json
{
  "driver": "r2",
  "bucket": "site-institucional",
  "prefix": "banners-institucional",
  "publicBaseUrlConfigured": true
}
```

Esse endpoint nao deve escrever no R2; ele apenas confirma envs carregadas no runtime Vercel.

- [ ] **Step 4: Testar localmente com env R2 real**

Run:

```bash
cd GestaoOuvintes/api-ouvintes
npm run r2:check
```

Expected:

```text
R2 banner check completed
```

Se falhar, corrigir credenciais Cloudflare antes de mexer no painel.

## Task 3: Corrigir Fluxo de Upload no Painel

**Files:**
- Modify: `GestaoOuvintes/painel-adm/src/services/api.ts`
- Modify: `GestaoOuvintes/painel-adm/src/pages/InstitutionalBannersPage.tsx`
- Test: `GestaoOuvintes/painel-adm/src/pages` ou teste de service existente

**Interfaces:**
- Consumes: `POST /api/admin/institutional-banners/assets`
- Produces: feedback claro para 502/503/415/422/413

- [ ] **Step 1: Confirmar FormData correto**

O upload deve enviar somente o arquivo no campo esperado pelo `@fastify/multipart`:

```ts
const form = new FormData();
form.append("file", file);
```

Nao setar manualmente `Content-Type`; o browser define o boundary multipart.

- [ ] **Step 2: Melhorar mensagens de erro de upload**

Mapear no painel:

```ts
const bannerErrorMessages = {
  MEDIA_STORAGE_NOT_CONFIGURED: "O R2 nao esta configurado na API publicada.",
  R2_UPLOAD_FAILED: "A API nao conseguiu gravar no Cloudflare R2. Verifique credenciais, bucket e permissao de escrita.",
  INVALID_IMAGE_TYPE: "Selecione JPEG, PNG, WebP ou AVIF.",
  INVALID_IMAGE: "A imagem nao pode ser processada.",
  IMAGE_TOO_LARGE: "A imagem deve ter no maximo 10 MiB.",
};
```

- [ ] **Step 3: Preservar ordenacao final automatica**

Ao criar banner novo, o painel nao precisa mandar ordem. A API ja calcula:

```ts
displayOrder: (last?.displayOrder ?? 0) + 1
```

Validar que o banner novo aparece no fim da lista apos `queryClient.invalidateQueries`.

## Task 4: Validar Banco e R2 Apos Upload

**Files:**
- Review: Neon PostgreSQL tables `media_asset`, `institutional_banner`, `admin_audit_log`
- Review: Cloudflare R2 bucket `site-institucional`

**Interfaces:**
- Consumes: upload bem-sucedido no painel
- Produces: evidencia de objeto no bucket e registro no banco

- [ ] **Step 1: Validar asset criado no banco**

Run SQL no Neon:

```sql
SELECT id, storage_provider, object_key, mime_type, width, height, byte_size, status, created_at
FROM media_asset
ORDER BY created_at DESC
LIMIT 5;
```

Expected:

```text
storage_provider = r2
object_key starts with banners-institucional/
mime_type = image/webp
status = ready
```

- [ ] **Step 2: Validar banner criado no banco**

Run SQL:

```sql
SELECT ib.title, ib.placement_key, ib.display_order, ib.active, ma.object_key
FROM institutional_banner ib
JOIN media_asset ma ON ma.id = ib.media_asset_id
WHERE ib.deleted_at IS NULL
ORDER BY ib.display_order ASC;
```

Expected: novo banner no final da ordem.

- [ ] **Step 3: Validar URL publica**

Com o `object_key` retornado:

```bash
curl -I '<R2_PUBLIC_BASE_URL>/<object_key>'
```

Expected:

```text
HTTP/2 200
content-type: image/webp
```

## Task 5: Ajustar Consumo no Site Institucional

**Files:**
- Modify: `radio-88-fm-institucional/src/services/institutional-banners/api.ts`
- Modify: `radio-88-fm-institucional/src/services/listener-registration/api.ts`
- Modify: `radio-88-fm-institucional/.env.example`
- Test: `radio-88-fm-institucional/src/services/institutional-banners/api.test.ts`
- Test: `radio-88-fm-institucional/src/hooks/useListenerRegistrationCampaign.test.tsx`

**Interfaces:**
- Consumes: `GET /api/public/institutional-banners?placement=home_hero`
- Consumes: `POST /api/public/session/resolve`
- Consumes: `GET /api/public/events?placement=institutional_modal`
- Produces: Hero com banners publicados e modal conectado a campanha ativa

- [ ] **Step 1: Padronizar URL base publica da GestaoOuvintes**

No institucional, configurar em producao:

```env
VITE_GESTAO_OUVINTES_API_URL=https://gestaoouvintes88fm-api.vercel.app
VITE_LISTENER_REGISTRATION_API_URL=https://gestaoouvintes88fm-api.vercel.app
VITE_LISTENER_REGISTRATION_ENABLED=true
VITE_LISTENER_REGISTRATION_PLACEMENT=institutional_modal
```

- [ ] **Step 2: Unificar fallback de URL base em codigo**

Ajustar `listener-registration/api.ts` para usar `VITE_GESTAO_OUVINTES_API_URL` como fallback quando `VITE_LISTENER_REGISTRATION_API_URL` nao estiver definida:

```ts
const value =
  import.meta.env.VITE_LISTENER_REGISTRATION_API_URL ??
  import.meta.env.VITE_GESTAO_OUVINTES_API_URL;
```

- [ ] **Step 3: Manter fallback local dos banners**

Em `Index.tsx`, manter comportamento atual:

```ts
if (bannersLoading || bannersFailed || managedBanners.length === 0) return staticHeroBanners;
```

Isso preserva `banner001.svg` e `banner002.svg` quando API/R2 falhar.

- [ ] **Step 4: Garantir cache-control adequado no fetch publico**

Manter `cache: "no-cache"` no fetch dos banners durante a fase de teste operacional. Depois da homologacao, avaliar cache curto baseado em `ETag`.

## Task 6: CORS e Publicacao Final

**Files:**
- Review: Vercel envs do projeto `gestaoouvintes88fm-api`
- Review: Vercel envs do projeto `gestaoouvintes88fm`
- Review: Vercel envs do projeto `radio-88-fm-institucional`

**Interfaces:**
- Produces: painel e institucional autorizados pela API

- [ ] **Step 1: Atualizar CORS da API**

Configurar em `gestaoouvintes88fm-api`:

```env
CORS_ALLOWED_ORIGINS=https://gestaoouvintes88fm.vercel.app,https://radio-88-fm-institucional.vercel.app,http://localhost:5174,http://127.0.0.1:5174,http://localhost:8080,http://127.0.0.1:8080
```

Adicionar o dominio real do institucional quando definido.

- [ ] **Step 2: Validar preflight do painel**

Run:

```bash
curl -i -X OPTIONS 'https://gestaoouvintes88fm-api.vercel.app/api/admin/institutional-banners/assets' \
  -H 'Origin: https://gestaoouvintes88fm.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Authorization, Content-Type'
```

Expected:

```text
HTTP/2 204
access-control-allow-origin: https://gestaoouvintes88fm.vercel.app
```

- [ ] **Step 3: Validar preflight do institucional**

Run:

```bash
curl -i -X OPTIONS 'https://gestaoouvintes88fm-api.vercel.app/api/public/session/resolve' \
  -H 'Origin: https://radio-88-fm-institucional.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type, X-Device-Token, X-Platform'
```

Expected: `204` com origem liberada.

## Task 7: QA End-to-End

**Files:**
- Test: `GestaoOuvintes/api-ouvintes`
- Test: `GestaoOuvintes/painel-adm`
- Test: `radio-88-fm-institucional`

**Interfaces:**
- Produces: checklist de aceite assinado para publicacao

- [ ] **Step 1: Validar API**

Run:

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm run build
npm test
```

Expected: todos passam.

- [ ] **Step 2: Validar painel**

Run:

```bash
cd GestaoOuvintes/painel-adm
npm run build
npm test
```

Expected: build e testes passam.

- [ ] **Step 3: Validar institucional**

Run:

```bash
cd radio-88-fm-institucional
npm run build
npm test
```

Expected: build e testes passam.

- [ ] **Step 4: Testar upload real em producao**

No painel publicado:

1. Login admin.
2. Acessar `Banners institucionais`.
3. Enviar PNG/JPEG pequeno.
4. Confirmar toast de sucesso.
5. Confirmar banner no fim da lista.
6. Confirmar imagem renderizada pelo `imageUrl` publico.

- [ ] **Step 5: Testar site institucional em producao**

No institucional publicado:

1. Abrir a Home em janela anonima.
2. Confirmar banner branco fixo como primeiro slide.
3. Confirmar banners publicados pelo painel depois do banner branco.
4. Desligar temporariamente a API ou simular falha e confirmar fallback local.
5. Confirmar modal de cadastro quando houver campanha ativa em `institutional_modal`.
6. Confirmar que usuario ja participante nao recebe formulario repetido para a mesma campanha.

## Criterios de Aceite

- [ ] `POST /api/admin/institutional-banners/assets` nao retorna mais `502` para imagem valida.
- [ ] Erros de R2/configuracao retornam JSON controlado com `code` util para o painel.
- [ ] Imagem valida e gravada no R2 dentro de `banners-institucional/`.
- [ ] Banco recebe `media_asset.status = ready` e banner criado com `display_order` final.
- [ ] Painel mostra mensagem clara quando R2 esta mal configurado.
- [ ] Institucional consome banners da API publicada quando existirem ativos.
- [ ] Institucional preserva fallback local quando API falhar ou lista vier vazia.
- [ ] Modal de cadastro usa a mesma API publicada e continua funcionando por campanha/dispositivo.
- [ ] CORS libera painel e institucional em producao.
- [ ] Docs de R2/deploy sao atualizadas com os nomes finais das variaveis.

## Riscos e Observacoes

- Se `sharp` falhar especificamente em Vercel, avaliar versao/arquitetura do pacote e build no Node 24. O sintoma tambem pode aparecer como `502` se a funcao quebrar antes do handler global formatar erro.
- Se `R2_PUBLIC_BASE_URL` usar `r2.dev`, e aceitavel para teste operacional, mas deve ser substituido por subdominio proprio antes de trafego real.
- Se o token R2 tiver permissao apenas de leitura, o erro esperado sera `R2_UPLOAD_FAILED` ou `AccessDenied` nos logs da Function.
- A API usa `R2_BUCKET_NAME` e `R2_OBJECT_PREFIX`; variaveis antigas como `R2_BUCKET` e `R2_BANNERS_PREFIX` nao surtem efeito.
- O upload de SVG pelo painel nao e parte do fluxo oficial atual; SVG manual no R2 exige operacao assistida, mas o formulario aceita apenas JPEG, PNG, WebP e AVIF.

---

## Status da Implementacao - 2026-07-22

### Implementado nesta execucao

- [x] Adicionado `getMediaStorageStatus()` em `api-ouvintes/src/services/media-storage/r2-media-storage.ts` sem expor secrets.
- [x] Adicionado endpoint protegido `GET /api/admin/institutional-banners/storage/check` em `api-ouvintes/src/routes/admin-institutional-banners.ts`.
- [x] Envolvido `POST /api/admin/institutional-banners/assets` com log seguro de metadados (`filename`, `mimeType`, status R2 e erro operacional), mantendo `AppError` como resposta JSON controlada.
- [x] Adicionado tipo `InstitutionalBannerStorageStatus` no painel.
- [x] Adicionado service `api.checkInstitutionalBannerStorage()` no painel.
- [x] Adicionado alerta operacional no painel para indicar se o R2 esta pronto, incompleto ou inacessivel.
- [x] Melhoradas mensagens de erro do painel para `FILE_REQUIRED`, `MEDIA_PUBLIC_URL_NOT_CONFIGURED`, `MEDIA_STORAGE_NOT_CONFIGURED` e `R2_UPLOAD_FAILED`.
- [x] Ajustado `radio-88-fm-institucional/src/services/listener-registration/api.ts` para usar `VITE_GESTAO_OUVINTES_API_URL` como fallback quando `VITE_LISTENER_REGISTRATION_API_URL` nao existir.
- [x] Ajustado `radio-88-fm-institucional/.env.example` para usar `http://localhost:3010` tambem no modal de cadastro.

### Validacao executada

```bash
cd GestaoOuvintes/api-ouvintes && npm run typecheck
cd GestaoOuvintes/api-ouvintes && npm run build
cd GestaoOuvintes/painel-adm && npm run build
cd radio-88-fm-institucional && npm run build
```

Todos passaram.

### Pendencias de producao apos merge/deploy

- [ ] Redeploy da API `gestaoouvintes88fm-api` para disponibilizar `/api/admin/institutional-banners/storage/check`.
- [ ] Redeploy do painel `gestaoouvintes88fm` para exibir o status operacional do R2.
- [ ] Confirmar no Vercel da API as envs exatas: `MEDIA_STORAGE_DRIVER`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, `R2_OBJECT_PREFIX`.
- [ ] Testar `GET /api/admin/institutional-banners/storage/check` autenticado no painel.
- [ ] Fazer upload de uma imagem raster pequena (`JPEG`, `PNG`, `WebP` ou `AVIF`) e confirmar persistencia no Neon + arquivo no bucket R2.
- [ ] Configurar no institucional publicado `VITE_GESTAO_OUVINTES_API_URL=https://gestaoouvintes88fm-api.vercel.app` e, opcionalmente, `VITE_LISTENER_REGISTRATION_API_URL=https://gestaoouvintes88fm-api.vercel.app`.
