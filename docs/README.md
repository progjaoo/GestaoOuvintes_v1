# Documentacao GestaoOuvintes

Este diretorio centraliza as guidelines e padroes do projeto **GestaoOuvintes**.

Stack do projeto: Node.js 24, TypeScript, Fastify, PostgreSQL, Drizzle ORM, React 18, Vite, Tailwind CSS, TanStack Query, Docker e Vitest.

Tipo: WEB/API.

## Indice

- [Visao geral](overview.md)
- [Arquitetura](architecture.md)
- [Backend API](backend-api.md)
- [Painel administrativo](frontend-admin.md)
- [Banco de dados](database.md)
- [Seguranca e privacidade](security-privacy.md)
- [Ambiente de desenvolvimento](development.md)
- [Setup local](setup-local.md)
- [Testes e qualidade](testing-quality.md)
- [Deploy e operacao](deployment-operations.md)
- [Cloudflare R2 para banners institucionais](cloudflare-r2-banners.md)
- [Guidelines de contribuicao](contribution-guidelines.md)
- [Mobile First](mobile-first.md)

## Projetos

```text
GestaoOuvintes/
├── api-ouvintes/      # Backend API, PostgreSQL e regras de negocio
├── painel-adm/        # Frontend administrativo web
├── docs/              # Documentacao geral do ecossistema
└── plans-cadastrosorteio/
```

## Leitura recomendada

1. Comece por [Visao geral](overview.md).
2. Leia [Arquitetura](architecture.md) para entender o fluxo entre painel, API e banco.
3. Para trabalhar no backend, siga [Backend API](backend-api.md) e [Banco de dados](database.md).
4. Para trabalhar no painel, siga [Painel administrativo](frontend-admin.md) e [Mobile First](mobile-first.md).
5. Antes de publicar, revise [Seguranca e privacidade](security-privacy.md) e [Deploy e operacao](deployment-operations.md).
