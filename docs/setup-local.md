# Setup local

Guia operacional para rodar o ecossistema **GestaoOuvintes** em desenvolvimento local.

Stack: Node.js 24, TypeScript, Fastify, PostgreSQL 16, Drizzle ORM, React 18, Vite, Tailwind CSS, Docker e Vitest.

Tipo: WEB/API.

## 1. Requisitos

- Node.js `24` ou superior.
- npm.
- Docker Desktop ativo.
- Portas livres:
  - PostgreSQL: `5434`
  - API: `3010`
  - Painel administrativo: `5174`
  - Site institucional, quando integrado: `8080`

Verifique versões:

```bash
node -v
npm -v
docker --version
docker compose version
```

## 2. Estrutura local

```text
GestaoOuvintes/
├── api-ouvintes/      # API Fastify + PostgreSQL + Drizzle
├── painel-adm/        # Painel administrativo React/Vite
├── docs/              # Documentacao
└── plans-cadastrosorteio/
```

## 3. Subir PostgreSQL local

Use o container de banco da API.

```bash
cd GestaoOuvintes/api-ouvintes
cp .env.example .env
docker compose up -d postgres
```

Confirme se o container ficou saudável:

```bash
docker compose ps
```

O banco local usa, por padrão:

```text
Host: localhost
Porta: 5434
Database: radio88_cadastros
User: radio88_user
Password: radio88_dev_password
```

## 4. Configurar API

Arquivo:

```text
GestaoOuvintes/api-ouvintes/.env
```

Para desenvolvimento local integrado com o site institucional e painel, mantenha:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3010
DATABASE_URL=postgresql://radio88_user:radio88_dev_password@localhost:5434/radio88_cadastros
DATABASE_SSL=false
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://localhost:8081,http://localhost:5173,http://localhost:5174,http://localhost:8082,http://127.0.0.1:8081,http://127.0.0.1:8082
CAMPAIGN_SLUG=lancamento-institucional-2026
PRIVACY_NOTICE_VERSION=2026-08-01
PRIVACY_NOTICE_URL=/privacidade
```

Se testar pelo celular na rede local, adicione a origem do site institucional:

```env
CORS_ALLOWED_ORIGINS=...,http://SEU_IP_LOCAL:8080
```

Exemplo:

```env
CORS_ALLOWED_ORIGINS=...,http://192.168.70.76:8080
```

Depois de alterar `.env`, reinicie a API.

## 5. Rodar migrations e seed

```bash
cd GestaoOuvintes/api-ouvintes
npm install
npm run db:migrate
npm run db:seed
```

O seed cria:

- campanha `lancamento-institucional-2026`;
- usuario admin inicial, conforme `.env`;
- dados basicos necessários para testar o painel.

Login padrão se estiver usando o `.env` de desenvolvimento atual:

```text
Usuario: admin
Senha: development-admin-password
```

Se estiver usando `.env.example`, ajuste `ADMIN_INITIAL_PASSWORD` para uma senha real antes do seed.

## 6. Rodar API em desenvolvimento

```bash
cd GestaoOuvintes/api-ouvintes
npm run dev
```

Endpoints de verificação:

```bash
curl http://localhost:3010/health
curl http://localhost:3010/ready
curl http://localhost:3010/api/public/campaigns/lancamento-institucional-2026
```

Resposta esperada da campanha ativa:

```json
{
  "slug": "lancamento-institucional-2026",
  "active": true
}
```

## 7. Rodar painel administrativo

Em outro terminal:

```bash
cd GestaoOuvintes/painel-adm
cp .env.example .env.local
npm install
npm run dev
```

Arquivo esperado:

```text
GestaoOuvintes/painel-adm/.env.local
```

Conteúdo:

```env
VITE_CADASTROS_API_URL=http://127.0.0.1:3010
```

URL local:

```text
http://localhost:5174
```

## 8. Integrar com o site institucional

No projeto do institucional:

```text
radio-88-fm-institucional/.env.local
```

Use:

```env
VITE_LISTENER_REGISTRATION_API_URL=http://localhost:3010
VITE_LISTENER_REGISTRATION_CAMPAIGN_SLUG=lancamento-institucional-2026
VITE_LISTENER_REGISTRATION_ENABLED=true
VITE_LISTENER_REGISTRATION_OPEN_DELAY_MS=800
VITE_LISTENER_REGISTRATION_DISMISS_DAYS=1
```

Rode o institucional:

```bash
cd radio-88-fm-institucional
npm run dev -- --host 0.0.0.0 --port 8080
```

Para forçar abertura do modal em desenvolvimento:

```text
http://localhost:8080/?cadastroOuvinte=1
```

Depois de cadastrar, acesse o painel em `http://localhost:5174` e confira o novo registro.

## 9. Teste manual de cadastro pela API

```bash
curl -i \
  -H 'Origin: http://localhost:8080' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:3010/api/public/listener-registrations \
  --data '{
    "campaignSlug": "lancamento-institucional-2026",
    "name": "Teste Local",
    "neighborhood": "Centro",
    "city": "Volta Redonda",
    "phone": "24999999999",
    "submissionToken": "11111111-1111-4111-8111-111111111111",
    "privacyNoticeVersion": "2026-08-01",
    "privacyAcknowledged": true,
    "marketingOptIn": false,
    "source": "institutional_web",
    "website": "",
    "utm": {
      "source": "local",
      "medium": "manual",
      "campaign": "setup-local",
      "content": "curl"
    }
  }'
```

Resposta esperada:

```text
HTTP/1.1 201 Created
```

Se rodar o mesmo `submissionToken` novamente, a API deve responder `200` com `already_processed`.

## 10. Comandos de qualidade

API:

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm test
npm run build
```

Painel:

```bash
cd GestaoOuvintes/painel-adm
npm run lint
npm test
npm run build
```

## 11. Troubleshooting

### Modal nao abre no institucional

Verifique:

- `VITE_LISTENER_REGISTRATION_ENABLED=true`;
- API rodando em `http://localhost:3010`;
- campanha ativa em `/api/public/campaigns/lancamento-institucional-2026`;
- navegador nao marcou campanha como concluida ou adiada no `localStorage`;
- use `?cadastroOuvinte=1` em desenvolvimento para forçar abertura.

### Erro `ORIGIN_NOT_ALLOWED`

A origem do frontend nao esta em `CORS_ALLOWED_ORIGINS`.

Exemplo para institucional local:

```env
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://localhost:5174
```

Reinicie a API depois da alteração.

### Painel nao lista cadastro novo

Verifique:

- se o `POST` retornou `201` ou `200`;
- se o painel esta apontando para a mesma API em `VITE_CADASTROS_API_URL`;
- se os filtros do painel nao estao escondendo o registro;
- se a campanha selecionada no filtro e a mesma do cadastro.

### Rate limit no cadastro

O limite local vem de:

```env
REGISTRATION_RATE_LIMIT_PER_MINUTE=5
```

Em desenvolvimento, aguarde um minuto ou ajuste temporariamente o valor no `.env` da API.

### Teste pelo celular nao cadastra

No celular, `localhost` aponta para o proprio aparelho. Use o IP do Mac:

```env
VITE_LISTENER_REGISTRATION_API_URL=http://SEU_IP_LOCAL:3010
```

E libere a origem no CORS da API:

```env
CORS_ALLOWED_ORIGINS=...,http://SEU_IP_LOCAL:8080
```

Reinicie API e institucional.

## 12. Validar o Cloudflare R2 para banners

Depois de configurar as variáveis R2 no `api-ouvintes/.env`:

```bash
cd GestaoOuvintes/api-ouvintes
npm run r2:check
```

O teste processa uma imagem, grava no bucket, confere a URL pública e remove o objeto. O resultado
esperado contém `R2 banner check completed`.

Para validar também autenticação, upload multipart, persistência e ordem final sem deixar dados de
teste:

```bash
cd GestaoOuvintes/api-ouvintes
npm run banner:check
```

O resultado esperado contém `Banner flow check completed`, com status `201` no upload e
na criação. Falhas de imagem retornam `INVALID_IMAGE_TYPE` ou `INVALID_IMAGE`;
indisponibilidade do R2 retorna `R2_UPLOAD_FAILED` com um `requestId` para correlação nos
logs.

## 13. Ordem recomendada para iniciar tudo

Em terminais separados:

1. Banco: `cd GestaoOuvintes/api-ouvintes && docker compose up -d postgres`
2. Migrações: `cd GestaoOuvintes/api-ouvintes && npm run db:migrate`
3. Seed: `cd GestaoOuvintes/api-ouvintes && npm run db:seed`
4. API: `cd GestaoOuvintes/api-ouvintes && npm run dev`
5. Painel: `cd GestaoOuvintes/painel-adm && npm run dev`
6. Institucional: `cd radio-88-fm-institucional && npm run dev -- --host 0.0.0.0 --port 8080`

Não execute dois processos da API na porta `3010`. Depois de alterar variáveis do
`.env`, reinicie somente a API para que as novas configurações sejam carregadas.

