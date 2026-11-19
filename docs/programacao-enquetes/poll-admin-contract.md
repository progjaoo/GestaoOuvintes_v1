# T09 - Contrato administrativo local de enquetes

POLLS_ENABLED=false por padrao; override local reservado ao agente principal. Sem votos, participacoes, snapshots, R2 ou publicacao externa. publish altera somente estado administrativo PostgreSQL.

## HTTP

Sessao administrativa obrigatoria; Cache-Control: no-store.

- GET /api/admin/polls?programId=&state=&after= -> {items: Poll[],nextCursor: UUID|null}, ordem id crescente, limite 100. Omitir filtros vazios.
- GET /api/admin/polls/:id -> Poll
- POST /api/admin/programs/:programId/polls -> Poll (201)
- PATCH /api/admin/polls/:id -> Poll
- POST /api/admin/polls/:id/{publish|close|archive|cancel}, body {version} -> Poll
- GET /api/admin/polls/:id/results -> {totalVotes,options:[{id,text,votes,percentage}]}

Poll: id, programId, programName, slug, question, context:string, identificationPolicy:anonymous|optional|required, allowMessage:boolean, options:[{id,text}], editionStartsAt, editionEndsAt, startsAt, endsAt (ISO UTC), state:draft|scheduled|published|closed|archived|canceled, version:number, totalVotes:number.

Create: slug,question,context,identificationPolicy,allowMessage,options:string[] (2..10 distintas),editionStartsAt,editionEndsAt,startsAt,endsAt. PATCH mesmo corpo completo + version. programId imutavel. IDs de alternativas preservados por posicao; remocoes desativam, nao apagam. Campos desconhecidos rejeitados.

## Ciclo e tempo

Offset/Z obrigatorio. Janela [inicio,fim) contida na edicao concreta. Edicao deve corresponder aos limites reais de slot ou excecao no resolvedor atual; interrupcao/substituicao dentro da edicao invalida-a. Datas arbitrarias nao criam edicoes. Revalidacao sob lock compartilhado do scope da grade, sessao e vinculo vigentes, relogio do banco apos locks.

Create -> draft. publish antes de startsAt -> scheduled; na janela e com elegibilidade exata -> published; apos fim -> 409. Sem scheduler: scheduled exige novo publish dentro da janela, nunca vira publicado implicitamente. draft -> canceled; scheduled/published -> closed ou canceled; closed/canceled -> archived. Sem reabertura/exclusao fisica. PATCH somente draft/scheduled; estrutura, identificacao e mensagem bloqueadas apos voto. Unique parcial permite apenas uma principal scheduled/published por edicao. Version otimista; retry com versao antiga retorna 409, nao novo efeito.

## RBAC e privacidade

poll.read/manage/publish/close/results.read global para admin. Announcer recebe somente poll.read/results.read participation; demais acoes requerem grant explicito global ou participation com vinculo vigente. Vinculo nunca concede permissao. SQL por acao/radio/sessao e grants atuais, DENY prevalece. IDs fora do escopo -> 404; sessao revogada -> 401. Create/PATCH: poll.manage; publish: poll.publish; close/archive/cancel: poll.close. Resultados privados: poll.results.read.

Auditoria somente IDs/radio/programa/estado/versao/acao, nunca pergunta/contexto/alternativas/PII integral. Contadores zero enquanto modulo de votos inexistente. Sem listener.phone.read ou alteracao de rotas legadas. 422 janela/edicao; 409 versao/ciclo/estrutura/unicidade; 404 ausente/fora do escopo. Sem migration persistente neste incremento.

## Autoridade e validacao local (11/11/2026)

Migration 0021_poll_admin.sql inclui radio_program_edition, radio_poll, radio_poll_option e armazenamento preparatorio radio_poll_vote. Resultados e totalVotes sao COUNT real de radio_poll_vote, nunca contador mock. FKs compostas impedem alternativa de outra enquete/programa/radio; unique impede duplicar voter_key na enquete. voter_key e apenas chave tecnica sintetica: nao implementa identidade, prova de visitante, consentimento ou dedupe publico seguro. Nenhum endpoint permite inserir votos. Um futuro writer deve adquirir lock da enquete e locks shared da grade/identidade antes de revalidar e inserir; a tabela preparada NAO torna T10 pronto.

21 testes unitarios direcionados (politica+administrativo) e 8 testes de integracao passaram. Migration runner existente aplicou 0001..0021 em PostgreSQL 16 Docker descartavel, sem volume, banco poll_admin_test. Integracao exercita DTO/201, nenhuma publicacao enfileirada, vinculo/DENY por acao, concorrencia otimista, janela arbitraria, voto SQL sintetico e agregados reais, FK de alternativa, dedupe, imutabilidade, principal unica, ciclo, auditoria minima, grant participation explicito, revogacao sob lock, publicacao agora e isolamento radio. Regressao geral: 192 aprovados/48 skips; suites condicionais nao representam regressao integrada completa. Para executar T09: RUN_POLL_TESTS=true RUN_INTEGRATION_TESTS=true POLLS_ENABLED=true, com DATABASE_URL exclusivamente local descartavel cujo nome contem _test e migrations aplicadas antes pelo npm run db:migrate. Desabilitar dotenv via DOTENV_CONFIG_PATH=/dev/null e fornecer configuracao sintetica. Nao usar banco persistente para esta suite.

Pendencias: frontend/E2E, testes hospedados, corrida com voto publico (inexistente), snapshot/publicacao externa e ativacao automatica de scheduled. Nao houve commit/push/deploy/Neon/R2 nem migration persistente. A permissao de publish e administrativa local, nao equivale a publicar no institucional.

### Integracao persistente local posterior

Apos validacao descartavel, main aplicou somente0021 no Docker radio88_feed_preview (11/11), habilitou POLLS_ENABLED no override local e integrou o painel. Os paragrafos anteriores sobre ausencia de migration persistente descrevem a entrega isolada do subagente, superada somente para Docker local. Ver fase-3-incrementos.md para backup, smoke e limites; Production/Neon permanecem intocados.
