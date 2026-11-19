# Plano 009 - Parte 2a: staging privado e preparacao OAuth

Data: 16/11/2026. Status: incremento tecnico testado; integracao completa ainda nao implementada.

## Entrega

- Migration aditiva `api-ouvintes/database/migrations/0024_calendar_poll_staging.sql`: fontes, eventos em staging, execucoes e catalogo de tres permissoes, sem grants automaticos.
- `api-ouvintes/src/services/calendar-poll-staging.ts`: persistencia idempotente, versao otimista, lease limitado, fencing por token/ator, cursor confirmado explicitamente, auditoria sem payload sensivel e revalidacao de sessao/RBAC no banco.
- `api-ouvintes/tests/integration/calendar-poll-staging.test.ts`: 14 cenarios de autorizacao, concorrencia, revogacao, isolamento, idempotencia e auditoria.
- Nenhuma rota publica ou administrativa nova foi exposta; CRUD manual e runtime ativo preservados.

## Validacao reproduzivel

No diretorio api-ouvintes, construir a imagem de dependencias se necessario:

```sh
docker build --target dependencies -t radio88-calendar-parser-test:local .
sh scripts/test-calendar-staging.sh
```

O runner usa PostgreSQL 17 descartavel, rede Docker interna, credenciais sinteticas, sem portas/volumes persistentes. Executa todas as migrations duas vezes, 14 testes de integracao + 37 do parser, typecheck e build. Resultado em 16/11: 51 aprovados; typecheck/build aprovados. Nao executa migration no banco ativo radio88-feed nem em producao. Regressao completa nao repetida neste incremento; a parte 1 registrou 244 aprovados/72 skips. Alertas de dependencias existentes continuam gate de release.

## Google Cloud e agenda reais

Projeto dedicado `radio-88-fm-enquetes` criado via BrowserOS, Calendar API habilitada, cliente Web OAuth `Gestao Enquetes - Docker Local` criado. App externo em teste, nao publicado. Escopo preparado: `https://www.googleapis.com/auth/calendar.events.readonly`. O backend deve restringir consultas ao calendarId permitido, pois o escopo Google nao limita a uma unica agenda.

Callbacks locais cadastrados: `http://127.0.0.1:3012/api/admin/calendar-integrations/oauth/callback` e equivalente `localhost`. Endpoints ainda NAO implementados; nao iniciar autorizacao antes de implementar state, PKCE, verificacao de sessao e armazenamento cifrado de tokens.

Credencial guardada fora do Git em `/Users/joaomvalente/.config/radio88-calendar/local-oauth-client.json`, diretorio 700 e arquivo 600. Nenhum valor secreto deve entrar em docs, frontend, logs ou fixtures. Nao existem tokens de acesso/refresh emitidos por este fluxo ainda.

Agenda confirmada: `88 - ENQUETE`, timezone America/Sao_Paulo, calendarId `8h0fgc1thts6ggq0453f561fd0@group.calendar.google.com`. Mirtilo e apenas apresentacao, nao identificador. Compartilhamento privado preservado.

Evento de 17/11/2026 confirmado visualmente: DECARABIA: E POSSIVEL CHAMAR UM DEMONIO ACHANDO QUE ESTA FALANDO EM LINGUAS? Dia inteiro, sem alternativas explicitas e sem programa especificado. Nao importado nem publicado. Programa padrao e janela devem ser confirmados antes da materializacao.

## Limites e proximo aceite

Parte 2a NAO conclui a fase 2: ainda faltam historico de revisoes, propriedade editorial, conflitos com enquetes manuais, validacao da grade persistida e materializacao em radio_poll. O estado conflict esta reservado, nao implementa deteccao de conflitos. Cancelamento altera somente staging, nao encerra enquete operacional. O service recebe previa interna confiavel do parser; nao deve ser exposto diretamente como contrato HTTP.

OAuth conectado, consulta real paginada, syncToken/410, painel de revisao, scheduler, publicacao e snapshot permanecem pendentes. Automatico desabilitado. Aprovar este incremento antes do proximo; confirmar se a agenda corresponde ao Bom Dia 88 ou a outro programa. Nao houve deploy, commit/push, alteracao do banco ativo ou publicacao real.
