# Guidelines de contribuicao

## Principios

- Trabalhe em mudancas pequenas e revisaveis.
- Preserve separacao entre API e painel.
- Nao misture refactor amplo com feature urgente.
- Documente mudancas de contrato.
- Nao deixe regra de negocio apenas no frontend.

## Backend

- Validar entrada com Zod.
- Regras ficam em services.
- Rotas devem ser finas.
- Erros esperados usam `AppError`.
- Nunca alterar migracao ja publicada.
- Criar testes quando tocar regra de negocio.

## Frontend

- Usar componentes existentes antes de criar novos.
- Manter Mobile First.
- Usar React Query para dados remotos.
- Nao duplicar estado derivado sem necessidade.
- Nao persistir senha.
- Encerrar sessao em `401`.

## Nomenclatura

- Arquivos TypeScript em kebab-case quando ja for padrao da pasta.
- Componentes React em PascalCase.
- Tipos compartilhados em `src/types`.
- Services com responsabilidade unica.

## Commits e revisao

Antes de abrir PR ou entregar:

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm run build
npm test

cd ../painel-adm
npm run lint
npm run build
npm test
```

## O que evitar

- Credenciais hardcoded.
- Query direta do painel no banco.
- Exportar dados no frontend.
- Enviar PII para analytics.
- Deixar endpoint administrativo sem autenticacao.
- Ignorar erro de migracao.
