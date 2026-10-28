# Stack local do Feed

O `radio88-feed` e um projeto Docker Compose isolado com quatro servicos: PostgreSQL, API, painel administrativo e institucional. O banco usa o volume externo de Preview que ja existia; nao execute `docker compose down -v`.

## Subir ou reconstruir

Na primeira configuracao, os arquivos ignorados `.env.feed-preview.compose`, `.env.feed-preview.local`, `.env.feed-preview.postgres` e `.env.feed-preview.site` precisam existir. O arquivo `.env.feed-preview.local` contem os segredos da API e deve permanecer local, com permissao `0600`.

```bash
./scripts/run-feed-preview.sh
```

Endpoints locais:

- Painel: `http://127.0.0.1:5181`
- Institucional e Feed: `http://127.0.0.1:8086/feed`
- API: `http://127.0.0.1:3012/health`
- PostgreSQL: `127.0.0.1:55471`

O banco desta stack e o PostgreSQL Docker, nao o Neon. O R2 utilizado deve ser exclusivamente o bucket de Preview. O painel envia novas midias ao bucket privado de Preview; o institucional local consome releases do bucket publico de Preview. Nenhuma configuracao Vercel ou dominio de producao e alterada.

## Preservacao

O volume `radio88-feed_feed-preview-postgres` e externo e contem os rascunhos e a biblioteca de midia existentes. Recriar containers nao remove o volume. Antes de aplicar migrations locais, gere um `pg_dump` e guarde-o fora do repositorio.

## Demonstracao local de 28/10/2026

O container institucional esta servindo uma copia estatica da revisao sintetica do CMS em `http://127.0.0.1:8086/feed/qa-feed-mvr0yk3f`. As midias foram copiadas por leitura do R2 privado de Preview para arquivos locais; nao houve publicacao no R2, Deploy Hook nem alteracao do status do rascunho no banco.

Esta demonstracao nao se atualiza automaticamente quando o rascunho muda. Ela nao comprova o pipeline de publicacao nem pode ser promovida a producao. Uma reconstrucao de imagem pode substitui-la pelo snapshot configurado.

Para restaurar somente a selecao anterior do site local, preservada no volume:

```bash
docker exec radio88-feed-institutional-1 node -e "require('node:fs').copyFileSync('/data/current.before-local-cms-demo-1793188054722.json', '/data/current.json')"
docker restart radio88-feed-institutional-1
```
