# Plano 009 - Parte 3a: leitura Google e staging privado

Data: 16/11/2026. Status: backend local implementado e validado em Docker descartavel. OAuth real, interface do painel e leitura da agenda de Producao ainda pendentes.

## O que foi implementado

- `google-calendar-api.ts`: troca de refresh token server-side e somente `GET /calendar/v3/.../events`; escopo verificado como `calendar.events.readonly`, `calendarId` fixado por `GOOGLE_CALENDAR_ALLOWED_ID`, parametros estaveis para sync (`showDeleted=true`, `singleEvents=true`, fuso `America/Sao_Paulo`), paginacao e tratamento sanitizado de erro/410.
- `calendar-poll-sync.ts`: sincronizacao manual paginada, lease renovavel, schedule lido uma vez por execucao, parsing dos eventos e staging por ID externo. Cursor so avanca apos todas as paginas serem persistidas; falha aborta o lease sem avancar o cursor.
- Eventos encerrados nao entram no staging inicial; cancelamentos recebidos continuam como estado local `canceled`. Nenhum evento antigo ou cancelado e apagado no Google ou no banco operacional.
- `0026_calendar_source_programs.sql`: tabela aditiva para programas explicitamente permitidos por fonte; preserva o programa padrao da migration 0024 e faz backfill idempotente. Uma fonte pode receber override `PROGRAMA:` somente para um programa ativo e permitido. Configuracao exige fonte inativa e versao atual.
- Eventos prontos ficam em `review` com `{ programId, poll }`; eventos incompletos ficam `invalid` ou pendentes com motivo limitado. O cadastro operacional `radio_poll` nunca e criado ou publicado por sincronizacao.
- Rotas sob `/api/admin/calendar-integrations`, habilitadas apenas com `GOOGLE_CALENDAR_ENABLED=true`: consulta de programas/fontes/eventos, criacao de fonte com agenda da allowlist, mapeamento de programas, ativacao/desativacao otimista, sincronizacao manual (3/min) e OAuth existente. Todas as rotas retornam `Cache-Control: no-store` e aplicam permissoes especificas.
- Listagem de staging tem cursor UUID e limite de 1-100. Tokens OAuth, syncToken e lease bearer nao sao retornados ao painel.
- Migrações 0024-0026 sao aditivas. Nenhuma migration foi aplicada ao `radio88-feed` persistente; nenhuma fonte real foi cadastrada/ativada.

## Fluxo de sync e recuperacao

1. Um operador com `calendar_integration.manage` conecta a conta Google e configura uma fonte. A fonte nasce inativa.
2. O operador seleciona um programa padrao e, se necessario, uma lista explicita de programas permitidos; para mudar o mapeamento, desativa a fonte primeiro.
3. Operador com `calendar_integration.sync` solicita a leitura. A API consulta apenas o calendar ID configurado no servidor.
4. O primeiro `nextSyncToken` e gravado somente no fim completo. Em sync incremental, o cursor so e substituido apos todas as paginas.
5. HTTP 410 limpa somente o cursor local e retorna `fullSyncRequired`; uma nova sincronizacao manual inicia leitura completa, sem apagar eventos staged.
6. Todos os eventos importados ficam privados para revisao. Publicar/encerrar e fluxo separado de enquetes; nao ha publicacao automatica.

Parametros da requisicao de eventos permanecem constantes. A consulta inicial nao usa filtros incompatíveis com `syncToken`; para evitar armazenar historico encerrado, a API o descarta localmente antes do staging. Um cancelamento vindo do Google e apenas registrado em staging. Nao existem metodos Calendar insert/update/delete no cliente.

## Rotas

| Metodo e rota | Permissao | Comportamento |
|---|---|---|
| `GET /status` | `calendar_integration.manage` | Estado OAuth sem credenciais |
| `POST /oauth/start` | `calendar_integration.manage` | Inicia PKCE, escopo de leitura |
| `GET /programs` | `calendar_integration.manage` | Lista nomes/IDs ativos para mapeamento |
| `GET /sources` | `calendar_integration.read` | Lista fontes, programa padrao e permitidos |
| `POST /sources` | `calendar_integration.manage` | Cria fonte inativa; calendar ID nunca vem do cliente |
| `PATCH /sources/:id/programs` | `calendar_integration.manage` | Atualiza lista/default com versao, fonte inativa |
| `PATCH /sources/:id` | `calendar_integration.manage` | Ativa/desativa com versao |
| `GET /sources/:id/events` | `calendar_integration.read` | Lista staging paginado |
| `POST /sources/:id/sync` | `calendar_integration.sync` | Leitura manual, rate limit 3/min |

## Validacao

`sh api-ouvintes/scripts/test-calendar-staging.sh` executado em rede interna Docker com PostgreSQL descartavel. Migrations aplicadas duas vezes; 64 testes passaram: parser 37, staging 16, OAuth 5, sync integrado 1 e cliente Google 5. `npm run typecheck` e `npm run build` passaram. O teste de sync usa apenas respostas HTTP sinteticas e prova: paginacao; evento por programa padrao; override de programa permitido; incompleto em revisao; descarte de evento encerrado; cursor final; HTTP 410; preservacao de todo staging; zero linhas em `radio_poll`.

Nenhuma conexao real, evento real, consentimento, migration persistente ou chamada Google foi executada. Containers/volumes existentes foram preservados. Sem commit, push, deploy ou publicacao.

## Proxima parte e gates

- Consentimento Google real com a conta autorizada e apenas leitura; nao registrar segredo/token em chat ou logs.
- Definir explicitamente o programa padrao da agenda antes de importar o evento de 17/11. A tela/API nao presumem Bom Dia 88; eventos sem `PROGRAMA:` usam o default configurado.
- Implementar a tela Genesis de integracao e revisao, com conexao, programa permitido, estado da fonte, sync manual, pendencias e diferenca; nenhuma acao de publicar implicita.
- Testar no container local `radio88-feed` somente depois de configurar segredos privados e escolher o mapeamento. Para cada fase, aguardar aprovacao antes de seguir.
