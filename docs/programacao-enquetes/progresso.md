# Progresso — Plano 009 Google Agenda e Enquetes

Atualizado em 17/11/2026. Este status descreve a integração validada no Docker local; não indica deploy nem ativação em produção.

## Concluído e validado localmente — Parte 3c

- A integração OAuth com a conta de Produção consulta somente a agenda permitida `88 - ENQUETE`, usando acesso read-only. A aplicação não cria, edita nem exclui eventos no Google Calendar.
- O worker persistente da API Docker inicia uma sincronização ao subir e repete a cada 5 minutos. O agendamento é configurável por `GOOGLE_CALENDAR_AUTO_SYNC_INTERVAL_SECONDS`; não depende de execução em background numa função serverless.
- Eventos são sincronizados para staging, vinculados de forma idempotente ao programa padrão **Bom Dia 88** ou a uma substituição explicitamente permitida, e transformados em enquetes locais com a janela da edição. Evento de dia inteiro usa o horário da grade; janela explícita do evento é respeitada dentro da edição.
- A enquete passa a ser consultável pelo institucional quando chega a janela configurada. A página inicial consulta a enquete ativa do programa e troca **OUVIR AO VIVO** por **PARTICIPE DO PROGRAMA**; o link leva ao formulário público.
- Eventos são lidos exclusivamente da agenda permitida **88 - ENQUETE**; fontes antigas com outro ID são ocultadas da lista administrativa, não podem exibir eventos staged nem iniciar sincronização.
- Toda pergunta válida importada sem configuração editorial explícita recebe o padrão **Sim/Não + opinião opcional**. Alternativas/modo diferentes só são usados quando configurados explicitamente no bloco editorial da descrição; a equipe pode ajustar o caso especial no Gestão. Títulos que não são perguntas completas continuam pendentes para revisão.
- Uma reclassificação do parser faz nova leitura completa. Só atualiza automaticamente uma enquete futura que ainda esteja `scheduled`, não tenha sido editada desde o vínculo, não tenha respostas, continue no mesmo programa e edição. Enquete publicada, alterada ou com respostas não é reescrita silenciosamente: vai para revisão.
- Cancelamento do evento pode encerrar a enquete vinculada, preservando votos e participações. Falhas da sincronização não removem dados nem alteram a Agenda.
- Migrações locais 0027 e 0028 registram a automação, vínculos e revisão do parser. A revisão 0028 foi aplicada no PostgreSQL local do container.

## Evidência da sincronização de 17/11

- A sincronização automática local leu 1.165 eventos; 5 conteúdos de staging mudaram durante a nova leitura.
- Resultado do materializador: 3 enquetes programadas/atualizadas, 3 vínculos já existentes, 15 itens requerendo revisão, 0 cancelamentos e 0 falhas técnicas.
- A enquete de hoje foi encontrada e está publicada para **Bom Dia 88**, das **09h30 às 12h (horário de Brasília)**. No banco local ela tem modo de voto e mensagem, opções **Sim** e **Não**, e texto opcional.
- No BrowserOS Neo, `http://127.0.0.1:8086/` exibiu **No Ar — Bom Dia 88** e **PARTICIPE DO PROGRAMA**. O link abriu a página pública da enquete com as opções e o campo de opinião.
- A página pública agora mostra somente o título da enquete (sem contexto longo) e separa pergunta e formulário em duas colunas em telas largas, empilhando-os em telas menores.
- Não foi enviado voto ou cadastro de ouvinte durante a validação.

## Testes

- Parser: 45 testes aprovados.
- Google Calendar, staging e sincronização em PostgreSQL descartável: 72 testes aprovados; migrations, typecheck e build aprovados.
- API pública de enquete: 21 testes aprovados.
- API e institucional locais foram reconstruídos; painel e PostgreSQL foram preservados e os quatro containers estão saudáveis. Nenhum deploy foi feito.

## Ajustes solicitados em 17/11

- Restrição estrita à agenda `88 - ENQUETE` em listagem, staging e execução de sync, além da validação já existente no cliente Google Calendar.
- Padrão de importação alinhado à operação editorial: **Sim**, **Não** e opinião opcional; casos diferentes devem ser configurados explicitamente/revisados pela equipe.
- Formulário institucional com título apenas e layout em duas colunas responsivas.
- Testes da página institucional: 4 aprovados; testes da integração de calendário: 72 aprovados (inclui 45 do parser); testes públicos da API: 21 aprovados. Build institucional, build/typecheck da API e build/teste do painel aprovados.
- Validação final local: a rota direta da enquete responde HTTP 200; API, institucional, painel e PostgreSQL estão saudáveis. No BrowserOS, a pergunta é exibida sem contexto longo e o formulário contém Sim/Não + opinião opcional.
- Corrigido o servidor de preview para servir o shell da aplicação em slugs dinâmicos `/enquetes/:slug`, evitando HTTP 404 em links diretos.
- O token local do hook de publicação do preview foi rotacionado durante a reconstrução; API e institucional receberam a configuração correspondente.
- Esta entrega é somente local. Google Calendar continua read-only e nenhum evento foi alterado; não houve deploy.

## Limitações e próximos passos

1. **15 itens aguardam revisão editorial**; não serão publicados apenas para aumentar cobertura. Conferir a lista em `/enquetes/integracao` no painel.
2. A frequência atual do worker é de 5 minutos. Eventos já sincronizados são exibidos no início da janela sem aguardar outro ciclo; eventos novos ou alterados podem levar até um ciclo para serem importados. Se esse atraso for inadequado, reduzir o intervalo e observar quota/erros antes de definir o valor de produção.
3. A automação ainda precisa ser instalada em topologia de produção compatível com processo persistente/agendador. Não presumir que o worker funcione em Vercel serverless.
4. Após a conferência dos itens pendentes, fazer teste editorial de evento futuro e de edição/cancelamento, sem escrita no Google Calendar.
5. Planejar rollout, observabilidade, recuperação e segredo OAuth de produção antes de qualquer ativação em produção.

Detalhes anteriores: [Parte 3b](plano-009-parte-3b.md). Visão geral e fases anteriores: [README](README.md).

## Plano 010 — calendario e gestao de enquetes

Atualizado em 17/11/2026. **Etapa 1 implementada no ambiente local; aguardando aceite visual.** As Etapas 2–5 nao foram iniciadas.

- O painel agora oferece `/enquetes/calendario` e `/enquetes/gestao`, com navegacao local dentro da area Enquetes. `/enquetes` direciona para a primeira secao permitida ao usuario. A visibilidade do calendario depende das permissoes de integracao de calendario existentes; acesso a enquetes/resultados nao concede acesso ao calendario, nem o contrario.
- O calendario e um prototipo Genesis com visualizacao de mes e lista, filtros por programa/origem/estado/busca e detalhe rapido em painel lateral. Os itens sao fixtures explicitamente identificadas como demonstracao, nao representam conteudo real do Google nem do banco.
- `Nova enquete` pode abrir o formulario existente com a data selecionada previamente. Isso apenas preenche o formulario; nao cria nem salva enquete automaticamente.
- Nenhuma chamada de API foi adicionada ao prototipo, nenhuma migracao foi criada e nenhum evento do Google Calendar foi criado, alterado ou excluido. A integracao Google existente continua em uma acao separada e somente para usuarios autorizados.
- Validacao local: 50 testes focados aprovados; TypeScript, ESLint e build Vite aprovados. O servico `panel` foi reconstruido e esta saudavel; API, institucional e PostgreSQL tambem permaneceram saudaveis. BrowserOS confirmou a rota local `http://127.0.0.1:5181/enquetes/calendario`.
- A lista inicial para mobile foi coberta por teste responsivo. O aceite visual manual de mobile e tema escuro ainda precisa ser conferido pelo usuario. O proximo passo e receber esse aceite antes de iniciar a Etapa 2 (projecao segura no backend).

## Plano 010 — projecao real e ajuste de fuso (17/11/2026)

- O calendario do Gestao substituiu os fixtures pela agenda Google read-only `88 - ENQUETE`, consultando a rota administrativa por intervalo. A projecao retorna somente titulo, programa, datas/horarios, estados editoriais e sincronizacao; descricao bruta e identificador externo nao sao enviados para a UI.
- Migration aditiva `0029_calendar_event_projection.sql` armazena metadados sanitizados dos eventos staged, inclusive itens pendentes de revisao. O incremento de revisao do parser reprocessa a agenda sem materializar enquetes retroativas.
- Corrigido o deslocamento de datas: PostgreSQL `DATE` agora e serializado no SQL como `YYYY-MM-DD` (data civil), sem conversao para timestamp UTC no JSON/browser. O caso da enquete/evento de 17/11 foi confirmado no banco como dia 17; a UI deve manter o dia civil 17.
- Validacoes locais: 257 testes unitarios da API, 19 testes de integracao em PostgreSQL Docker descartavel (incluindo RBAC, cursor e regressao da data), 5 testes do calendario do painel; typecheck/build da API e typecheck/lint/build do painel aprovados. Migration 0029 aplicada; API e painel locais saudaveis.
- A aba autenticada do calendario no BrowserOS estava sob propriedade de outro agente e nao foi recarregada. Conferencia visual final ainda pendente numa sessao autenticada propria. Etapas 4 (gestao enxuta) e 5 (regressao/aceite final) do Plano 010 continuam abertas. Nenhum deploy foi feito e nenhum evento foi alterado no Google Calendar.

## Preparacao de login e OAuth para Preview (18/11/2026)

- O usuario confirmou que o Super Admin desejado continua sendo `joaomvprog@gmail.com`. Isso define a identidade pretendida, mas nao prova que exista uma conta com senha conhecida na producao; a senha antiga nao deve ser reutilizada nem exibida.
- Diagnostico da producao: o release atual da API ainda usa o fluxo legado de usuario/senha, responde que o bootstrap inicial ja foi feito e nao inclui o fluxo de login por e-mail/reset da branch. Portanto nao e possivel recuperar com seguranca a senha atual nem afirmar qual login legado esta ativo sem consultar a administracao autenticada do banco.
- Na branch `codex/preview-gestao-enquetes-programacao-20261118`, a API agora aceita somente callbacks OAuth exatos para localhost (Docker), o alias estavel de Preview e o dominio oficial da API de producao; callbacks externos, HTTP em Vercel, query strings e caminhos diferentes sao recusados.
- Foi preparada uma rota serverless protegida por `CRON_SECRET` para sincronizar a agenda em execucao agendada, com trava advisory no PostgreSQL contra concorrencia entre instancias. O timer continua habilitado apenas no Docker local. O endpoint e read-only: nao cria, edita ou exclui eventos no Google Calendar.
- `api-ouvintes/vercel.json` agenda a rota a cada cinco minutos. A rota so e registrada quando `GOOGLE_CALENDAR_CRON_ENABLED=true`; esse flag requer Calendar ativo e `CRON_SECRET`. Nenhum segredo foi gravado no repositorio.
- Validacao: typecheck, build da API e suite completa aprovados (32 arquivos; 278 testes aprovados e 96 ignorados), alem de testes especificos dos gates OAuth/cron (11 aprovados). `git diff --check` aprovado.
- Cliente OAuth correto identificado no projeto `radio-88-fm-enquetes` (conta `producao88fm@gmail.com`); mantidos os callbacks Docker e adicionados/verificados os callbacks HTTPS exatos do alias estavel de Preview e da API oficial. Nenhum secret foi rotacionado/desativado.
- O consentimento OAuth e Externo, mas ainda esta em **Testando**, com `producao88fm@gmail.com` cadastrado como usuario de teste. Isso permite validar o Preview com essa conta; nao e uma configuracao definitiva para uso continuo em producao. A publicacao/verificacao do app ainda precisa ser concluida para evitar restricao de acesso e expiracao de refresh token do modo de teste.
- Vercel ainda nao tem variaveis `GOOGLE_CALENDAR_*`, `CRON_SECRET` nem `RESEND_*` no ambiente de Preview/Producao. A producao tambem nao tem valores de `ADMIN_INITIAL_USERNAME/PASSWORD`; esse seed nao e um mecanismo de recuperacao de uma conta existente.
- Proximos passos: configurar credenciais/flags somente no ambiente Preview, aplicar e conferir migrations 0024–0029 no banco isolado de Preview, provisionar/validar a identidade de teste e conectar a agenda read-only. Ativar o Cron apenas depois da conexao e da revisao do app OAuth.
- **Producao inalterada:** nao houve deploy, merge, migration, provisionamento/reset de Super Admin, envio de e-mail ou escrita no Google Calendar. O login por e-mail/reset e a ativacao de OAuth em producao dependem de validar o Preview e de aprovacao explicita para o rollout.

## Preview de login e Google Calendar (19/11/2026)

- A branch `codex/preview-gestao-enquetes-programacao-20261118` foi publicada no GitHub no commit `05dee4f`; o Vercel iniciou a implantacao Preview da API.
- Criado o branch Neon `codex-gestao-enquetes-programacao-preview-20261118` no projeto dedicado `gestao-ouvintes-feed-preview`, separado do projeto Neon de Producao. As migrations forward-only `0017`–`0029` foram aplicadas somente nessa copia isolada.
- O Super Admin `joaomvprog@gmail.com` foi provisionado somente no banco isolado de Preview, com login `joaomprog-root`. A senha e unica e nao esta no repositorio nem neste documento; trocar apos validar o acesso.
- Variaveis OAuth do Google Calendar, `CRON_SECRET`, chave de cifragem dos tokens e `DATABASE_URL` foram configuradas somente no ambiente Preview da branch. A agenda autorizada e exclusivamente `88 - ENQUETE` e a integracao permanece read-only; nenhum evento foi alterado.
- O projeto do painel recebeu `VITE_CADASTROS_API_URL` com escopo Preview desta branch, apontando para a API Preview, para evitar que o painel de teste grave na API de Producao.
- A primeira tentativa de login no painel Preview revelou bloqueio CORS para o alias da branch. Foi adicionado `CORS_ALLOWED_ORIGINS` especifico para o Preview, restrito ao alias exato do painel. A implantacao seguinte ficou `READY` e o login com `joaomprog-root` foi validado no BrowserOS, chegando a `/ouvintes/cadastros`.
- O callback OAuth Preview foi registrado no cliente Google correto. A tela de consentimento continua em modo **Testando**, com `producao88fm@gmail.com` como usuario de teste. O OAuth ainda nao foi iniciado nem consentido.
- A rota `/enquetes/integracao` retornou **Acesso não autorizado** para o Super Admin provisionado. A causa e a politica atual: a conta raiz nao recebe grants implicitos; a migration 0024 cria as permissoes Calendar sem as conceder a qualquer papel. A tentativa de tornar `is_super_admin` um wildcard global de permissoes foi rejeitada por revisao de seguranca e nao foi aplicada. E necessaria uma decisao explicita sobre grants globais da conta protegida ou grants limitados ao modulo Calendar.
- Corrigida a query do script de provisionamento raiz com casts explicitos no e-mail. O typecheck passou, 11 testes focados passaram e o provisionamento isolado confirmou a identidade.
- **Login de Producao identificado, sem reset:** o release atual continua no fluxo legado username/senha. O banco atual contem os identificadores ativos `admin` e `admin@radio88fm.com.br`; nao foi possivel obter senhas existentes (hashes nao sao recuperaveis). A identidade `joaomvprog@gmail.com` ainda nao existe nesse schema legado.
- **Producao continua inalterada:** nenhum env de Producao foi criado/alterado, nenhum deploy/merge para `main`, migration, reset de senha ou envio de e-mail foi feito. Validar login e OAuth no Preview antes de preparar a ativacao de Producao.

## Resend e seed real para revisao (19/11/2026)

- RESEND_API_KEY armazenada como Secret no Vercel em Preview e Production, fornecida diretamente pelo titular. Remetente `Radio 88 FM <acessos@resend.grupogtf.com.br>` configurado nos dois ambientes; ADMIN_APP_BASE_URL aponta separadamente para o painel oficial e o alias estavel da branch Preview. Nenhuma chave/token/senha esta neste documento.
- Redeploy realizado explicitamente em Preview pelo painel Vercel: `dpl_8MqKZc65HuhMNbNjdG7f4SCwXw2W`, READY. Nao houve deploy ou merge em Producao.
- BrowserOS: login da conta raiz, solicitacao de confirmacao, abertura do link correto no Preview e confirmacao do email validados. Resend confirmou `delivered` para a confirmacao e para o email de recuperacao solicitado pelo formulario publico.
- Redefinicao de senha consumida no Preview: email confirmado, authz_version incrementada e zero sessoes antigas ativas. A senha temporaria anterior foi substituida durante o teste; o titular pode usar Esqueci minha senha para definir uma senha pessoal. Nenhuma senha de Producao alterada.
- Permissoes Calendar `read`, `manage` e `sync` concedidas explicitamente apenas a conta raiz de Preview, com aprovacao do titular, sem wildcard de outros modulos. Consentimento Google e sincronizacao real em Preview ainda devem ser concluidos separadamente; nao confundir Resend com OAuth conectado.
- Novo seed independente: [operacao e catalogo](seed-programacao-real.md). 11 programas, apresentadores publicos e 37 faixas reais; nao cria contas, permissoes, campanhas, enquetes ou dados de teste. Preserva edicoes/capas/IDs existentes; dry-run padrao, confirmacao remota e rollback atomico em conflito.
- Testes: 5 integracoes em PostgreSQL Docker descartavel; 4 testes do adaptador Resend; suite unitaria completa 268 aprovados; typecheck/build aprovados. Primeira tentativa da suite sem variaveis ficticias obrigatorias falhou na configuracao; repetida corretamente e aprovada.
- Seed aplicado somente no Neon Preview isolado; primeira execucao criou 11 programas/37 faixas; segunda criou zero, preservando 11/37. Nao aplicado nem agendado automaticamente em Producao; sem publicacao R2 automatica. Capas/arquivos locais nao foram importados pelo seed.
- Conferencia final da API Preview: reutilizacao do token retornou 400; senha antiga retornou 401; login por email com a nova senha retornou 200; consulta autenticada de programas retornou 200 e 11 programas. Tokens e senhas nao foram registrados. O titular pode usar o fluxo de recuperacao para escolher sua senha pessoal.

## Calendar Preview/Production e fila de importacao (19/11/2026)

- Conferidos no Google Cloud os callbacks fixos ja registrados: alias estavel da API Preview e `https://gestaoouvintes88fm-api.vercel.app/api/admin/calendar-integrations/oauth/callback`, preservando callbacks locais. Nenhuma chave rotacionada nem evento Google alterado.
- Credenciais OAuth e allowlist exclusiva `88 - ENQUETE` preparadas tambem nas variaveis Production do Vercel, com chave de cifragem e CRON_SECRET proprios, sem copiar refresh token local. Configuracao nao equivale a deploy/migrations/consentimento de Producao; ativacao depende do rollout validado e permissao do operador.
- Conexao OAuth read-only do Preview autorizada no navegador, callback respondeu connected=true. Fonte configurada com Bom Dia 88 como programa padrao; somente essa agenda e permitida.
- Causa da enquete de dia inteiro de hoje: o parser ja produzia corretamente 19/11, 09h30–12h (Sao Paulo), mas centenas de itens invalidos historicos ocupavam o LIMIT 500 antes das enquetes validas. Materializador agora prioriza cancelamentos e previews validos antes de invalidos, ordenando pela janela do programa.
- Regressao Docker: 501 itens historicos invalidos nao impedem a materializacao de enquetes validas de dia inteiro. 48 testes backend focados aprovados, incluindo parser; 6 testes frontend Calendar/upload e build do painel aprovados; typecheck/build API aprovados.
- Aplicada a correcao no runtime Docker local e reconstruida a imagem `radio88-feed-api:local`. Reprocessamento automatico publicou a enquete de hoje `DIA DOS HOMENS: OS HOMENS ESTAO DESAPRENDENDO A SEREM MACHOS?`, 09h30–12h; nao ampliou janela nem escreveu no Google.
- Upload Preview conferido: POST /api/admin/programs/assets retornou 201 para PNG 1920x1080, conversao WebP e URL publica HTTP 200. Seletor de arquivo no BrowserOS abriu e aceitou arquivo; nenhuma capa real foi substituida. Falha relatada de abrir seletor nao reproduzida nesta verificacao; nao houve alteracao arbitraria de RBAC/R2. Arquivo de homologacao ficou sem vinculo de programa.
- Texto antigo do painel que dizia nao haver publicacao automatica foi corrigido para refletir o fluxo atual, mantendo revisao de itens incompletos/conflitantes e privacidade das participacoes.
- Primeira carga real de Preview identificou um segundo gargalo: leitura de todo o historico da agenda dentro de funcao Vercel de 30s. A carga inicial agora consulta os ultimos 35 dias e todos os eventos futuros; a mesma data minima e mantida entre paginas. Incrementais usam somente syncToken, sem timeMin/timeMax, conforme [contrato Google](https://developers.google.com/workspace/calendar/api/v3/reference/events/list). Historico previamente importado nao e apagado; eventos futuros sem alteracoes nao sao excluidos da carga inicial. Seis testes do cliente Google aprovados, incluindo parametros/paginacao.
- Validacao real final do Preview: OAuth conectado, fonte ativa restrita a 88 - ENQUETE/Bom Dia 88; sincronizacao concluida (`completed`), seis enquetes materializadas. A carga limitada concluiu dentro do runtime serverless. Banco Preview preservou os itens ja staged na tentativa anterior; nao houve limpeza destrutiva. Produção continua apenas com chaves preparadas, sem deploy/migrations nem token OAuth copiado.
