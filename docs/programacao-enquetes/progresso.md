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
