# Arquitetura

## Tipo

WEB/API.

## Stack

Backend:

- Node.js 24.
- TypeScript estrito.
- Fastify 5.
- PostgreSQL 16.
- Drizzle ORM com `node-postgres`.
- Zod.
- JWT.
- Argon2id.
- ExcelJS.
- Vitest.
- Docker Compose.

Frontend:

- React 18.
- TypeScript estrito.
- Vite.
- Tailwind CSS.
- TanStack React Query.
- React Router.
- Radix Dialog.
- Sonner.
- Vitest e Testing Library.

## Fluxo principal

```text
Usuario administrativo
  -> painel-adm
  -> api-ouvintes
  -> PostgreSQL
```

Fluxo publico futuro:

```text
Site institucional
  -> modal de cadastro
  -> api-ouvintes
  -> PostgreSQL
```

## Responsabilidades

`api-ouvintes`:

- Validar entradas.
- Proteger rotas administrativas.
- Persistir cadastros e campanhas.
- Aplicar idempotencia.
- Gerar exportacoes.
- Auditar exportacoes.
- Controlar CORS, rate limit e seguranca HTTP.

`painel-adm`:

- Autenticar usuario administrativo.
- Consultar campanhas e cadastros.
- Exibir filtros e paginacao.
- Solicitar exportacoes pela API.
- Encerrar sessao em `401`.

## Fronteiras importantes

- O painel nao deve montar CSV/XLSX no navegador.
- O painel nao deve conhecer segredos.
- O banco nao deve ser acessado diretamente pelo frontend.
- Regras de permissao devem ficar no backend.
- PII nao deve ser enviada para analytics ou logs desnecessarios.
