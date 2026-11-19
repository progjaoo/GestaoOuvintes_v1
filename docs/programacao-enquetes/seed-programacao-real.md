# Seed de programas e grade reais

## Escopo

Comando independente `npm run db:seed:programming`, separado de `db:seed` (legado, que cria conta/campanha).
Catalogo aprovado de 11 programas, nomes publicos dos apresentadores e 37 faixas semanais, em `America/Sao_Paulo`, com vigencia inicial 11/11/2026, igual ao cadastro local.

Nao cria usuarios, senhas, permissoes, vinculos RBAC de locutores, campanhas, enquetes, votos, mensagens, tokens, imagens ou publicacoes. Os apresentadores sao nomes publicos; associar contas a programas continua sendo uma acao administrativa explicita.
Nao copia dados de demonstracao, IDs locais, credenciais ou objetos R2. Capas ja associadas a programas existentes sao preservadas; banco novo fica sem capas ate upload/migracao de midia autorizada para o namespace do ambiente.

## Seguranca e repeticao

- Exige `PROGRAMMING_SEED_DATABASE_URL` explicita; nao carrega `.env` nem usa `DATABASE_URL` implicitamente.
- Padrao e simulacao com rollback; `--apply` confirma gravacao.
- Banco remoto exige tambem `--confirm-remote`, mesmo na simulacao.
- Usa transacao e a mesma trava advisory da gestao de programacao.
- Reutiliza programa por `radio-88` + slug; preserva nome, descricao, apresentadores editados, imagem e IDs existentes.
- Reutiliza faixa ativa identica com vigencia que cobre o periodo completo. Nao reativa registros inativos nem altera/exclui horarios antigos.
- Programa inativo, duplicacao de faixa ou conflito de recorrencia aborta a transacao inteira para revisao manual. Nenhuma substituicao silenciosa da grade.
- Encerramento `00h` e armazenado como minuto 0 do dia seguinte, conforme contrato existente (Cristo Vive, sabado e domingo).
- Nao publica automaticamente no institucional. Publicar grade continua pelo fluxo administrativo e R2 do ambiente.

## Execucao

Aplique antes as migrations versionadas pelo runner existente. Obtenha a URL do ambiente correto por canal seguro e exporte `PROGRAMMING_SEED_DATABASE_URL` sem inclui-la no historico de comandos. Depois:

```sh
cd api-ouvintes
npm run db:seed:programming
npm run db:seed:programming -- --apply
```

Em banco remoto, acrescente `--confirm-remote` aos dois comandos. Confira host, projeto, branch Neon, backup e ambiente antes de aplicar. Nao adicione o seed ao startup, build ou deploy automatico.

Resultado esperado em banco vazio: 11 programas e 37 faixas criados. Segunda execucao: zero criacoes, 11 programas e 37 faixas preservados.

## Grade incluida

| Programa | Dias | Horario |
| --- | --- | --- |
| Fato Popular | Segunda a sexta | 05:00–09:30 |
| Bom Dia 88 | Segunda a sexta | 09:30–12:00 |
| Altar 88 | Segunda a sexta | 12:00–13:00 |
| Temperatura Gospel | Segunda a sexta | 13:00–15:00 |
| Favorito | Segunda a sexta | 15:00–17:00 |
| Ritmo 88 | Segunda a sexta | 17:00–19:00 |
| Raizes | Sabado e domingo | 06:00–08:00 |
| Cristo em Nos | Sabado | 13:00–15:00 |
| Passado de Presente | Sabado | 20:00–22:00 |
| Cristo Vive | Sabado e domingo | 23:00–00:00 |
| Clamor das Nacoes | Domingo | 14:00–15:00 |

## Recuperacao

Simulacao e erros revertem tudo. Apos commit, nao existe undo destrutivo automatico: preservar backup, comparar IDs e corrigir pelo CRUD com auditoria. Nao apagar programas com historico para refazer seed.

## Validacao em 19/11/2026

- PostgreSQL 17 Docker descartavel, migrations existentes: 5 testes de integracao aprovados (dry-run, ausencia de contas, repeticao, preservacao, meia-noite e conflito).
- Preview Neon isolado: simulacao aprovada; primeira aplicacao 11/37; segunda aplicacao 0/0, preservados 11/37. Nenhum seed aplicado em Producao.
- Suite unitaria Docker: 268 testes aprovados; typecheck e build da API aprovados.
