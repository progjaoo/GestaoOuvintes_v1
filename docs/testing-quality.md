# Testes e qualidade

## Backend

Comandos:

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm run build
npm test
```

Teste de integracao:

```bash
./scripts/prepare-test-db.sh
DATABASE_URL=postgresql://radio88_user:<senha>@127.0.0.1:5434/radio88_cadastros_test npm run test:integration
```

Regras:

- Teste de integracao deve usar banco com `_test` no nome.
- Validacoes de schema devem ser cobertas.
- Fluxos criticos: login, cadastro publico, idempotencia, exportacao e campanhas.

## Frontend

Comandos:

```bash
cd GestaoOuvintes/painel-adm
npm run lint
npm run build
npm test
```

Regras:

- Testar rotas protegidas.
- Testar login e bootstrap do primeiro admin.
- Testar formatadores e cliente de API.
- Testar estados de erro, vazio e carregamento quando aplicavel.

## Checklist antes de entregar

- TypeScript sem erros.
- Lint sem erros no painel.
- Build passando.
- Testes unitarios passando.
- Se alterar banco, migracao criada.
- Se alterar contrato API, tipos do painel atualizados.
- Se alterar exportacao, auditoria preservada.
