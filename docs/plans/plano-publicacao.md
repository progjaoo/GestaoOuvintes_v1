# Plano de publicacao - GestaoOuvintes

## Objetivo

Publicar e estabilizar o ecossistema **GestaoOuvintes** em producao na Vercel, com:

- API `api-ouvintes` publicada e conectada ao Neon PostgreSQL.
- Painel administrativo `painel-adm` publicado como SPA Vite.
- Comunicacao segura entre painel, API, banco Neon e Cloudflare R2.
- Fluxo validado para login, campanhas, ouvintes e banners institucionais.

## Estado atual validado em 22/07/2026

### API

URL publica:

```text
https://gestaoouvintes88fm-api.vercel.app
```

Endpoint validado:

```bash
curl -i https://gestaoouvintes88fm-api.vercel.app/health
```

Resultado esperado:

```text
HTTP/2 200
{"status":"ok","service":"radio88-cadastros-api",...}
```

Conclusao: a API esta publicada e responde corretamente.

### Painel administrativo

URL publica desejada:

```text
https://gestaoouvintes88fm.vercel.app
```

Endpoint validado:

```bash
curl -i https://gestaoouvintes88fm.vercel.app/
```

Resultado atual:

```text
HTTP/2 404
x-vercel-error: NOT_FOUND
```

Build local validado em `GestaoOuvintes/painel-adm`:

```bash
npm run build
```

Resultado local: build Vite concluido com sucesso, gerando `dist/index.html` e assets.

Conclusao: o problema do painel publicado nao esta no build React/Vite local. O 404 indica configuracao incorreta do projeto Vercel do painel, normalmente causada por deploy da raiz do monorepo em vez da pasta `painel-adm`.

## Causa raiz provavel do 404 no painel

O projeto Vercel `gestaoouvintes88fm` aparece com:

```text
framework: null
live: false
latestDeployment.readyState: BLOCKED
```

Isso indica que a Vercel nao esta detectando corretamente o app Vite do painel. Em um monorepo, isso ocorre quando o projeto esta apontando para a raiz `GestaoOuvintes/`, onde nao existe o `package.json` do painel, em vez de apontar para:

```text
GestaoOuvintes/painel-adm
```

## Correcao aplicada no repositorio

Foi adicionado um `vercel.json` na raiz de `GestaoOuvintes/` para cobrir o caso em que o projeto Vercel `gestaoouvintes88fm` esteja configurado com Root Directory na raiz do monorepo.

Esse arquivo força:

```text
installCommand: cd painel-adm && npm install
buildCommand: cd painel-adm && npm run build
outputDirectory: painel-adm/dist
rewrite SPA: /(.*) -> /index.html
```

Com isso, mesmo antes de ajustar o Root Directory no dashboard para `painel-adm`, um novo deploy do projeto oficial deve gerar e servir a SPA do painel corretamente.

## Arquitetura alvo

```text
Usuario/Admin
  -> https://gestaoouvintes88fm.vercel.app
  -> painel-adm Vite
  -> VITE_CADASTROS_API_URL
  -> https://gestaoouvintes88fm-api.vercel.app
  -> Neon PostgreSQL
  -> Cloudflare R2 para banners institucionais
```

## Configuracao esperada no Vercel

### Projeto da API

Projeto:

```text
gestaoouvintes88fm-api
```

Root Directory:

```text
api-ouvintes
```

Framework:

```text
Other
```

Build Command:

```bash
npm run build
```

Output Directory:

```text
N/A
```

Arquivo obrigatorio:

```text
api-ouvintes/vercel.json
```

Comportamento esperado:

- Todas as rotas sao reescritas para `api/index.ts`.
- O Fastify roda como Serverless Function.
- `/health` e `/ready` respondem em producao.

### Projeto do painel

Projeto oficial desejado:

```text
gestaoouvintes88fm
```

Root Directory obrigatorio:

```text
painel-adm
```

Framework Preset:

```text
Vite
```

Install Command:

```bash
npm install
```

Build Command:

```bash
npm run build
```

Output Directory:

```text
dist
```

Arquivo obrigatorio:

```text
painel-adm/vercel.json
```

Comportamento esperado:

- `/` carrega o painel.
- Rotas internas do React Router funcionam por fallback para `/index.html`.
- Nenhuma rota do painel deve retornar `404_NOT_FOUND` da Vercel.

## Variaveis de ambiente

### API

Configurar em Production e Preview:

```env
NODE_ENV=production
DATABASE_URL=<connection-string-pooled-do-neon>
DATABASE_SSL=true
JWT_SECRET=<segredo-forte>
IP_HASH_SECRET=<segredo-forte>
DEVICE_TOKEN_SECRET=<segredo-forte>
CORS_ALLOWED_ORIGINS=https://gestaoouvintes88fm.vercel.app,https://gestaoouvintes88fm-admin.vercel.app,http://localhost:5174,http://127.0.0.1:5174
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<cloudflare-access-key-id>
R2_SECRET_ACCESS_KEY=<cloudflare-secret-access-key>
R2_BUCKET=site-institucional
R2_PUBLIC_BASE_URL=<url-publica-r2-ou-subdominio-cdn>
R2_BANNERS_PREFIX=banners-institucional
```

Nao registrar valores reais de segredo na documentacao ou no Git.

### Painel

Configurar em Production e Preview:

```env
VITE_CADASTROS_API_URL=https://gestaoouvintes88fm-api.vercel.app
```

## Plano de execucao

### 1. Corrigir projeto do painel no Vercel

No dashboard do projeto `gestaoouvintes88fm`:

1. Acessar `Settings > General`.
2. Ajustar `Root Directory` para `painel-adm`.
3. Confirmar que o framework detectado e `Vite`.
4. Confirmar `Build Command` como `npm run build`.
5. Confirmar `Output Directory` como `dist`.
6. Salvar as configuracoes.
7. Cancelar qualquer deployment bloqueado antigo, se estiver impedindo novo production deployment.
8. Criar novo deploy pela branch `main`.

### 2. Garantir arquivos de deploy no repositorio

Confirmar que estes arquivos estao versionados:

```text
GestaoOuvintes/vercel.json                         # fallback para projeto Vercel apontando para a raiz do monorepo
GestaoOuvintes/api-ouvintes/vercel.json
GestaoOuvintes/api-ouvintes/api/index.ts
GestaoOuvintes/painel-adm/vercel.json
```

### 3. Validar API apos qualquer redeploy

```bash
curl -i https://gestaoouvintes88fm-api.vercel.app/health
curl -i https://gestaoouvintes88fm-api.vercel.app/ready
```

Validar campanha publica do modal:

```bash
curl -i https://gestaoouvintes88fm-api.vercel.app/api/public/placements/institutional_modal/campaign
```

### 4. Validar CORS da API para o painel

```bash
curl -i -X OPTIONS 'https://gestaoouvintes88fm-api.vercel.app/api/admin/auth/login' \
  -H 'Origin: https://gestaoouvintes88fm.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type, Authorization'
```

Resultado esperado:

```text
HTTP/2 204
access-control-allow-origin: https://gestaoouvintes88fm.vercel.app
```

Se retornar `403 ORIGIN_NOT_ALLOWED`, atualizar `CORS_ALLOWED_ORIGINS` no projeto da API e fazer novo deploy da API.

### 5. Validar painel em producao

```bash
curl -i https://gestaoouvintes88fm.vercel.app/
```

Resultado esperado:

```text
HTTP/2 200
content-type: text/html
```

Validar manualmente no browser:

1. Abrir `https://gestaoouvintes88fm.vercel.app`.
2. Fazer login admin.
3. Acessar `Campanhas`.
4. Criar campanha de teste.
5. Publicar campanha.
6. Acessar `Banners institucionais`.
7. Criar banner com imagem.
8. Confirmar se a imagem foi enviada ao R2 e se o registro aparece na lista.
9. Acessar o institucional e confirmar se banners publicados aparecem no Hero com fallback local quando a API falhar.

## Plano de rollback

Se `gestaoouvintes88fm.vercel.app` continuar retornando 404 apos ajuste de Root Directory:

1. Usar temporariamente o projeto funcional `gestaoouvintes88fm-admin`, caso esteja disponivel.
2. Atualizar `CORS_ALLOWED_ORIGINS` da API para aceitar o dominio temporario.
3. Validar o fluxo completo no dominio temporario.
4. Corrigir ou recriar o projeto oficial `gestaoouvintes88fm` com Root Directory `painel-adm`.
5. Migrar o dominio definitivo para o projeto correto.

## Checklist de aceite

- [ ] API `https://gestaoouvintes88fm-api.vercel.app/health` retorna 200.
- [ ] API `https://gestaoouvintes88fm-api.vercel.app/ready` retorna 200.
- [ ] Painel `https://gestaoouvintes88fm.vercel.app/` retorna 200 e carrega o app React.
- [ ] Refresh em rota interna do painel nao retorna 404.
- [ ] `VITE_CADASTROS_API_URL` aponta para a API de producao.
- [ ] `CORS_ALLOWED_ORIGINS` contem o dominio final do painel.
- [ ] Login admin funciona em producao.
- [ ] Criacao/publicacao de campanha funciona em producao.
- [ ] Cadastro de ouvinte pelo institucional funciona em producao.
- [ ] Gestao de banners institucionais funciona com Cloudflare R2.
- [ ] Fallback dos banners locais no institucional continua funcional.

## Observacoes operacionais

- O projeto `gestaoouvintes88fm` deve ser tratado como o painel oficial se o objetivo for manter a URL `https://gestaoouvintes88fm.vercel.app`.
- O projeto `gestaoouvintes88fm-admin`, se existente, pode ser usado como ambiente temporario de validacao, mas a API precisa liberar CORS para esse dominio.
- O erro `404_NOT_FOUND` da Vercel no painel nao e erro de React Router. Ele acontece antes do app React carregar.
- Os avisos de React Router v7 no console nao bloqueiam a publicacao atual.
