# API de Cadastro de Ouvintes

Serviço Node.js isolado para campanhas e cadastros de ouvintes da Rádio 88 FM.

Esta pasta implementa a primeira etapa do
`prd-001-cadastro-ouvintes-lancamento-1-agosto.md`:

- PostgreSQL dedicado.
- API pública de configuração e cadastro.
- API administrativa autenticada.
- Paginação e filtros.
- Exportações CSV/XLSX auditadas.
- Docker, migrações, seed, testes e backup.

O frontend institucional e o `painel-adm` serão integrados nas próximas etapas.

## Stack

- Node.js 24.
- TypeScript em modo estrito.
- Fastify 5.
- PostgreSQL 16.
- Drizzle ORM com `node-postgres`.
- Zod.
- JWT.
- Argon2id.
- ExcelJS.
- Vitest.
- Docker Compose.

## Estrutura

```text
api-ouvintes/
├── database/migrations/
├── docs/
├── scripts/
├── src/
│   ├── config/
│   ├── database/
│   ├── lib/
│   ├── plugins/
│   ├── routes/
│   ├── schemas/
│   └── services/
├── tests/
├── compose.yaml
├── Dockerfile
└── package.json
```

## Início rápido com Docker

1. Crie a configuração local:

```bash
cp .env.docker.example .env
```

2. Troque obrigatoriamente:

```env
POSTGRES_PASSWORD=
JWT_SECRET=
IP_HASH_SECRET=
ADMIN_INITIAL_PASSWORD=
```

3. Suba banco e API:

```bash
docker compose up -d --build
```

4. Verifique:

```bash
curl http://127.0.0.1:3010/health
curl http://127.0.0.1:3010/ready
curl http://127.0.0.1:3010/api/public/campaigns/lancamento-institucional-2026
```

O Compose executa migrações e seed antes de iniciar a API.

## Desenvolvimento sem container da API

Mantenha apenas o PostgreSQL em Docker:

```bash
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

API: `http://127.0.0.1:3010`.

PostgreSQL local: `127.0.0.1:5434`.

## Credencial inicial

O usuário inicial é definido por:

```env
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=<senha-forte>
```

O seed cria o usuário somente se ele ainda não existir. Alterar a variável depois
não troca a senha já armazenada.

Se o banco estiver vazio, o painel administrativo também permite criar o primeiro
administrador pela tela de login. Esse cadastro fica bloqueado automaticamente
assim que existir qualquer usuário em `admin_user`.

## Comandos

```bash
npm run typecheck
npm run build
npm test
npm run db:migrate
npm run db:seed
./scripts/prepare-test-db.sh
DATABASE_URL=postgresql://radio88_user:<senha>@127.0.0.1:5434/radio88_cadastros_test npm run test:integration
./scripts/backup.sh
./scripts/restore-test.sh backups/<arquivo>.dump
```

## Segurança aplicada

- Banco publicado somente em `127.0.0.1` no ambiente local.
- Rede Docker privada entre API e PostgreSQL.
- JWT nas rotas administrativas.
- Senha com Argon2id.
- Rate limiting no cadastro e login.
- CORS por allowlist.
- Body limitado a 32 KiB.
- Helmet.
- Idempotência por campanha e `submissionToken`.
- Hash HMAC do IP, sem persistir IP bruto.
- Logs com campos sensíveis redigidos.
- Neutralização de fórmulas em CSV/XLSX.
- Auditoria de toda exportação.

Consulte [API.md](docs/API.md) e [OPERATIONS.md](docs/OPERATIONS.md).
