# Ambiente de desenvolvimento

## Requisitos

- Node.js 24 ou superior.
- npm.
- Docker e Docker Compose.
- PostgreSQL via container local.

## Subir API com Docker

```bash
cd GestaoOuvintes/api-ouvintes
cp .env.example .env
docker compose up -d --build
```

Verificacao:

```bash
curl http://127.0.0.1:3010/health
curl http://127.0.0.1:3010/ready
```

## Rodar API em modo desenvolvimento

```bash
cd GestaoOuvintes/api-ouvintes
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

API local:

```text
http://127.0.0.1:3010
```

## Rodar painel

```bash
cd GestaoOuvintes/painel-adm
cp .env.example .env.local
npm install
npm run dev
```

Painel local:

```text
http://localhost:5174
```

## Ordem recomendada

1. Suba PostgreSQL.
2. Aplique migracoes.
3. Rode seed.
4. Suba API.
5. Suba painel.
6. Faça login ou crie o primeiro acesso se o banco estiver vazio.

## Variaveis

Backend usa `.env` privado.

Frontend usa `VITE_*`, que e publico no bundle.

Nunca coloque segredo em `VITE_*`.
