# Backend API

Projeto: `GestaoOuvintes/api-ouvintes`

Tipo: API.

## Responsabilidade

A API e a fonte de verdade do sistema. Ela gerencia campanhas, cadastros, autenticacao administrativa, exportacoes e auditoria.

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

## Padroes de codigo

- Rotas ficam em `src/routes`.
- Validacoes de entrada ficam em `src/schemas` com Zod.
- Regras de negocio ficam em `src/services`.
- Configuracao de ambiente fica em `src/config/env.ts`.
- Banco e schema ficam em `src/database`.
- Erros controlados usam `AppError`.

## Endpoints principais

Publicos:

- `GET /health`
- `GET /ready`
- `GET /api/public/campaigns/:slug`
- `POST /api/public/listener-registrations`

Administrativos:

- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/bootstrap-status`
- `POST /api/admin/auth/bootstrap`
- `GET /api/admin/campaigns`
- `POST /api/admin/campaigns`
- `PUT /api/admin/campaigns/:id`
- `GET /api/admin/listener-registrations`
- `GET /api/admin/listener-registrations/:id`
- `GET /api/admin/listener-registrations/export`

## Bootstrap administrativo

Quando o banco esta vazio, a API permite criar o primeiro administrador por `POST /api/admin/auth/bootstrap`.

Assim que existe qualquer registro em `admin_user`, esse fluxo e bloqueado.

## Comandos

```bash
npm run dev
npm run typecheck
npm run build
npm test
npm run db:migrate
npm run db:seed
```

## Contrato detalhado

Consulte tambem:

- `api-ouvintes/docs/API.md`
- `api-ouvintes/docs/OPERATIONS.md`
