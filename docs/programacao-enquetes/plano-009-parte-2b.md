# Plano 009 - Parte 2b: base OAuth local somente leitura

Data: 16/11/2026. Status: base backend implementada e testada em Docker; consentimento OAuth real e leitura de eventos ainda pendentes.

## Alteracoes

- Migration aditiva `0025_calendar_oauth.sql`: state OAuth temporario vinculado ao usuario/sessao/versao RBAC e conexao com refresh token cifrado.
- Servico `google-calendar-oauth.ts`: Authorization Code + PKCE S256, state de uso unico com prazo de 10 minutos, verificacao de sessao/permissao antes e depois do exchange, escopo fixo `calendar.events.readonly`, cifra AES-256-GCM e status sem revelar credenciais.
- Rotas locais sob `/api/admin/calendar-integrations`: consultar status, iniciar consentimento e callback sem log de query. RBAC exige `calendar_integration.manage` global e revalida no banco.
- Feature flag `GOOGLE_CALENDAR_ENABLED=false` por padrao. Nesta etapa a configuracao validada permite apenas callback HTTP loopback e runtime nao-Vercel; segredo fica exclusivamente no backend.
- Nenhum endpoint de escrita/exclusao de eventos foi criado. Nenhum cliente recebe token. Nenhuma operacao altera Google Calendar. Mantenha a agenda original intacta.

## Testes

`sh api-ouvintes/scripts/test-calendar-staging.sh` cria rede interna e PostgreSQL descartavel, aplica migrations duas vezes e roda 56 testes (14 staging, 5 OAuth, 37 parser), typecheck e build. Resultado: 56 aprovados, typecheck/build aprovados. Nenhum token Google real ou chamada ao Google usado durante estes testes. Banco radio88-feed ativo nao foi migrado.

## Pendencias para fatia seguinte

- Configurar segredo da API no ambiente Docker local (fora Git) e habilitar OAuth apenas nesse container isolado.
- Executar consentimento real com conta de teste e confirmar status conectado; nenhum refresh token emitido ate aqui.
- Implementar consulta Google Calendar API estritamente GET/list em calendarId allowlisted, paginacao e syncToken; tratar 410 por nova leitura sem excluir dados.
- Definir explicitamente programa da agenda antes de converter eventos. Agenda/evento nao tem programa nem alternativas explicitas. O parser deve manter casos ambiguos em revisao.
- Implementar configuracao de fonte, leitura real e revisao no painel, todas locais; sem publicar automaticamente.

Status: OAuth apenas preparado no Cloud e no backend. O evento de 17/11 segue na agenda e nao foi copiado/importado. Nao foi removido nem alterado evento algum. Sem deploy, producao ou commit/push.
