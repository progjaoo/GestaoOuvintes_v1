# Cores das capas de programas

Estado em 19/11/2026: implementado e testado localmente, branch `codex/program-image-edge-color-local`. Nao publicado em producao.

## Causa da divergencia

O Institucional aceitava `imageEdgeColor`, mas a API publicava somente `imageUrl`. Um mapa de nomes de arquivos de Preview preenchia as cores antigas. O upload em Production cria outro UUID, por isso a imagem aparecia com a paleta neutra. Nao depende da enquete estar aberta ou fechada.

## Correcao

- Migracao incremental `0030_program_image_edge_color.sql` adiciona `media_asset.program_edge_color` opcional com constraint hexadecimal. Nenhuma migracao anterior alterada.
- O upload calcula a cor da borda direita da imagem otimizada/orientada usando Sharp ja existente. Amostragem reduzida, pixels transparentes ignorados e agrupamento por cor; sem predominancia suficiente, retorna null.
- A cor pertence ao arquivo, nao ao nome do programa. Trocar/remover a imagem troca/remove o metadado naturalmente pela FK do asset. As autorizacoes e validacoes de upload existentes permanecem.
- Publicacao inclui `imageEdgeColor` no programa do snapshot quando disponivel. Contrato aditivo: snapshots antigos sem a propriedade continuam validos.
- O Institucional usa a cor na borda/fundo do card e mantem a logo da radio no mini player. Sem imagem/cor confiavel, preserva fallback neutro; erro da imagem limpa a identidade da capa.

## Capas existentes

`src/scripts/backfill-program-image-colors.ts` trabalha apenas com assets ready vinculados a programas de radio-88 e com prefixo do namespace configurado. Le os objetos pelo SDK R2, sem URL fornecida por visitante, sem modificar arquivos no bucket. Limite de 10 MiB, timeout e processamento sequencial.

Padrao dry-run. Para gravar, exige `--apply --actor=<UUID de usuario interno ativo>`; os updates sao condicionais a arquivo/status/cor ainda ausente, com auditoria e nova revisao pendente de grade. Nao publica automaticamente no R2 nem altera usuarios, enquetes ou sessoes. CLI administrativa privilegiada; nao e endpoint publico.

```sh
node dist/src/scripts/backfill-program-image-colors.js
node dist/src/scripts/backfill-program-image-colors.js --apply --actor=<UUID>
```

No Docker local existente e necessario remover a marca VERCEL_ENV herdada da execucao de CLI, como ja faz o comando de inicializacao do container. Nao reutilizar essa excecao para desabilitar validacoes em Vercel.

## Validacao local

- Typecheck/build API aprovados. 272 testes unitarios aprovados, incluindo tres testes de extracao e regressao da programacao.
- Backup do PostgreSQL local antes da migracao; nenhuma escrita em Neon/Production.
- Sete assets calculados; primeira aplicacao atualizou sete, segunda atualizou zero. Nova revisao pendente contem as cores, inclusive Bom Dia 88 #E73C24. Arquivos R2 nao regravados.
- API local atualizada pelo dist compilado e migracao, mantendo ambiente/rede/volumes. Imagem reproduzivel `radio88-feed-api:edge-color-local`, tambem etiquetada como `radio88-feed-api:local`, preparada para futuras recriacoes. O container atual preserva a configuracao e recebeu os arquivos compilados; seu Image ID original nao foi alterado por essa copia.
- Grade local publicada pelo painel autorizado apos login do titular: revisao 53, snapshot publico HTTP 200 com 11 programas e 37 horarios. BrowserOS confirmou Temperatura Gospel com borda #FFB900, fundo derivado e altura 370px; mini player manteve a logo. Nenhum voto criado nem enquete reaberta.

## Rollout futuro aprovado separadamente

1. Backup e migracao 0030 em cada banco de destino pelo runner `db:migrate`.
2. Publicar a API compativel com o novo metadado.
3. Dry-run do backfill no namespace correto; revisar cores; aplicar com ator autorizado e conferir auditoria.
4. Publicar a grade pelo fluxo administrativo, conferir snapshot e card no site. Imagens novas passam a carregar sua propria cor no upload.
5. A mudanca nao reabre enquete encerrada e nao modifica Google Agenda. Nao copiar IDs de assets ou dados de Preview para Production.

Falha de extracao preserva imagem e fallback; falha de publicacao usa retry existente. Migracao forward-only: a coluna opcional pode permanecer se o codigo precisar voltar. Preservar no rollback o contrato que aceita imageEdgeColor; a API anterior usa schema strict e recusaria um snapshot com o campo novo. Se for imprescindivel voltar a esse codigo, publicar primeiro um snapshot sem o metadado pelo fluxo autorizado ou manter o parser compativel. Nao apagar a coluna ou as imagens para recuperar o servico.
