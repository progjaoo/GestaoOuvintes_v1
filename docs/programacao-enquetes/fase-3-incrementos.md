# Fase 3 - Enquetes e participacoes

## 11/11/2026 - Inicio incremental / T09 parcial

Ambiente: worktree /Users/joaomvalente/.codex/worktrees/feed-production-security/gestao. Preservado o diff existente de RBAC, identidade e programacao. Nenhum deploy, commit, push, banco remoto, migration ou dado persistente alterado neste incremento.

### Implementado

- services/poll-policy.ts: janela obrigatoriamente contida na edicao concreta; normalizacao UTC; fronteiras [inicio,fim); ciclo sem reabertura; pergunta, modo e alternativas imutaveis apos voto.
- Elegibilidade pura de entrada exige estado published, programa elegivel e instante confiavel dentro da janela. Nao e um endpoint nem substitui validacao/locks transacionais. O chamador futuro deve resolver grade/override e usar relogio do servidor apos adquirir locks.
- Modos iniciais tipados: guest_anonymous e guest_identified. Nenhum voto, dispositivo ou perfil e criado.
- tests/unit/poll-policy.test.ts: 17 cenarios. TDD: falha inicial por modulo ausente; apos implementar, passou.

### Validado

- API npm run typecheck aprovado.
- Vitest direcionado: 17 testes de enquete + 12 de grade = 29 aprovados no host.
- Mesmos 29 testes aprovados na imagem Docker dependencies Node 24 (radio88-plan007-test:local), container descartavel com --network none, codigo montado somente leitura e nenhum .env/volume de banco. Container removido automaticamente; imagem local mantida para reuso.
- Nao executada suite integral, integracao SQL, migracao, teste E2E ou QA visual de enquetes, pois ainda nao existem rotas/telas ligadas.

### UI e aprovacao incremental

Leitura: preservar identidade Genesis, React18/Router6/Query/Sonner, cores e tipografia atuais. Sem migrar Tailwind3 para 4 nem instalar outro design system. CLI shadcn info confirmou Vite/TS/Tailwind3 e ausencia de components.json; wrappers locais ja existem e nao serao sobrescritos silenciosamente. Adaptar shadcn Radix, consistente com dependencias atuais. Consultadas documentacoes oficiais de Sidebar/DropdownMenu e Web Interface Guidelines.

Primeiro conjunto aguardando aceite: Sidebar com grupos Operacao, Conteudo e Administracao; usuario no SidebarFooter com DropdownMenu e tema Claro/Escuro/Sistema/Sair. Nenhuma mudanca visual aplicada. Os proximos componentes do CRUD devem ser aprovados por area, conforme pedido do usuario.

### Revisao por subagente Identidade/RBAC

Revisao estatica somente leitura confirmou gates antes de grants/CRUD:

1. Rotas legadas admin-registrations.ts usam presence de listener.phone.read sem avaliar escopo. Exigir global no dominio legado antes de conceder leitura de telefone restrita a programas.
2. Nao copiar programming-service.write para participacoes: exige global, audita resultado integral e enfileira publicacao. Separar permissao por recurso, auditoria minima sem PII e snapshot publico.
3. AdminScreenAccessPage cria ALLOW global; apresentar explicitamente escopo programas vinculados para acessos de locutores.
4. Perfil/dispositivo legado existe, mas nao prova identidade verificada; nao associar ou revelar cadastro por telefone.
5. RUN_PROGRAMMING_TESTS e diferente de RUN_INTEGRATION_TESTS; registrar ambas as flags na suite aplicavel para nao ocultar testes pulados.

### Proximos incrementos

- Aprovar Sidebar/usuario/temas e migrar shell de forma compativel, sem alterar autorizacao ou rotas existentes.
- Reconciliar catalogo poll.* e participation.*, escopos global/participation, SQL filtrado e revogacao dentro da transacao.
- Edicoes persistidas, migrations aditivas apos 0020, constraints, unicidade de enquete principal, versao e idempotencia.
- CRUD administrativo, publicacao/encerramento/arquivo, resultados privados e moderacao; exclusao fisica de votos/mensagens nao e CRUD operacional.
- Snapshot versionado compativel sem SQL publico; voto/participacao com autoridade PostgreSQL, dedupe e consentimentos separados.
- Telas aprovadas, institucional, testes SQL concorrentes em banco Docker descartavel e smoke em radio88-feed apos backup local.

Fase 3 NAO concluida. O nucleo puro nao esta conectado a rotas, banco, API publica ou UI e nao deve ser tratado como protecao de um CRUD inexistente. Production permanece inalterada.

## 11/11/2026 - Primeiro conjunto de UI aprovado e entregue localmente

Aceite explicito do usuario: Sidebar com grupos Operacao, Conteudo e Administracao, usuario no rodape com DropdownMenu e temas Claro/Escuro/Sistema. Nenhum aceite implicito dos componentes do futuro CRUD.

### Alteracoes

- shadcn configurado para Radix/Vite/Tailwind3. Novos componentes oficiais em painel-adm/src/components/ui/shadcn, evitando colisao de Button.tsx/button.tsx no Mac. Wrappers Genesis existentes preservados; migracao total de componentes fora deste incremento.
- AppNavigation separa grupos e conserva exatamente os filtros por permissao e destinos existentes. Grupos vazios nao aparecem. Nao concede acesso nem substitui guards/API.
- NavUser usa AvatarFallback, DropdownMenu com opcoes de tema selecionaveis por teclado e logout existente, com erro em Sonner.
- Sidebar desktop recolhe a icones; mobile abaixo de 1024 usa Sheet com titulo, foco e fechamento apos navegar. Sem cookie adicional de sidebar; atalho Ctrl/Cmd+B nao captura editores/formularios.
- ThemeProvider integra preferencia do sistema, persistencia somente da escolha local, cross-tab, color-scheme e Sonner. CSS semantico preserva cores/tipografia e o fundo claro Genesis; cores fixas de superficies/textos de telas antigas foram substituidas mecanicamente por tokens, sem mudar campos, layout, rotas ou acoes. Modo escuro nao altera arquivos/imagens.
- Link de pular para conteudo e apenas um main semantico; SidebarInset usa div.

### Validacao e limites

- Lint e build aprovados. Suite integral: 85 testes, 22 arquivos, incluindo 6 novos de navegacao/usuario e testes de tema. Warning do bundle principal >500 kB permanece; nao foi declarado gate de performance concluido.
- BrowserOS no painel Docker: login normal realizado pelo usuario; temas claro/escuro, menu de usuario e recolher/expandir conferidos visualmente. Voltou a Claro/expandido. Nenhuma conta, papel, grant, programa ou publicacao foi modificado pelo agente neste smoke.
- Mobile Sheet e fechamento por navegacao cobertos por teste de componente; QA em dispositivos fisicos/mobile e contraste de todos os estados legados continuam pendentes. Nao foi feita auditoria completa de dependencias neste incremento.
- Somente radio88-feed-panel-1 recriado na mesma porta 5181. API, institucional, PostgreSQL e volumes mantidos.

### Rebuild local excepcional

O build Compose original ficou bloqueado na consulta de metadata do nginx:1.27-alpine no Docker Hub. A tentativa iniciada pelo agente foi cancelada, sem interromper o painel antigo. Mantido o Dockerfile original para rebuilds normais.

Alternativa usada: npm run build com VITE_CADASTROS_API_URL=http://127.0.0.1:3012 explicitamente; contexto temporario contendo somente dist; runtime copiado da imagem local anterior (tag radio88-feed-panel:before-sidebar-20261111), sem baixar nem atualizar Nginx. Um primeiro build sem esse argumento falhou no smoke de conexao da API e foi substituido antes da validacao final. Dockerfile temporario em /tmp/radio88-panel-sidebar.Dockerfile. Nenhuma chave ou .env enviado ao build.

Rollback local: reapontar a imagem panel para a tag before-sidebar-20261111 e recriar somente panel com --no-build --no-deps. Nao usar down -v/--remove-orphans. A imagem atual radio88-feed-panel:local contem o novo bundle funcional.

Sem commit, push, Preview, Production ou migration neste incremento. Fase 3 segue parcial: nucleo puro inicial e shell aprovados; CRUD de enquetes/participacoes e os gates RBAC documentados acima permanecem pendentes.

## 11/11/2026 - T09 administrativo integrado ao Docker local

Aceite do usuario: Table e filtros programa/edicao/estado; DropdownMenu; editor em pagina propria com FieldGroup/Field; AlertDialog nas transicoes e feedback Sonner. Nao foram acrescentados alert/confirm/prompt nativos.

- Migration aditiva 0021_poll_admin.sql: edicoes concretas, enquetes, alternativas e armazenamento preparatorio de votos. Aplicada primeiro em banco Docker descartavel e depois somente em radio88_feed_preview, pelo runner existente. Backup privado /tmp/radio88-before-enquetes.Ci56UK. Sentinelas antes/depois: 3 usuarios, 12 programas, 44 horarios. Nenhum dado/credencial de producao importado.
- API administrativa sob POLLS_ENABLED (false por padrao; true somente compose.programming-local.yaml). CRUD de rascunho, transicoes publicar/agendar, encerrar, cancelar, arquivar; consulta manual de agregados SQL reais. Sem exclusao fisica. Versao otimista, limites da grade, excepcao interior, unicidade principal por edicao, radio/programa e vinculo vigente validados na transacao. Permissoes de cada acao independentes; audita somente IDs/estado/versao.
- Painel: /enquetes e /enquetes/nova, lista com filtros/paginacao, edicao e resultados privados. Sem refresh periodico. Datas mostram explicitamente o fuso local do dispositivo; API valida a edicao em America/Sao_Paulo.
- Gate legado corrigido: listener.phone.read com escopo participation nao revela telefone na lista global, detalhe ou exportacao de cadastros. Tres testes unitarios cobrem lista/detalhe/global; regressao real de exportacao com banco ainda pendente.
- Politica pura de linguagem em participation-language-policy.ts: normalizacao e lista inicial de termos inteiros, sem devolver ou registrar a mensagem original. Dez testes. NAO esta conectada a endpoint publico; nao e garantia contra todo abuso e exige moderacao humana. Ver moderacao-opinioes.md.
- Conteudo real enviado pelo usuario documentado como exemplo, nao cadastrado/publicado nem associado a programa sem confirmacao. Smoke criou somente fixture local validacao-local-enquetes-20261111 no Fato Popular, em edicao futura 12/11 05h00-09h30; ciclo administrativo e resultados testados, sem publicacao R2/institucional. Historico preservado.

Validacao: typecheck/build API aprovados; regressao API 192 aprovados/48 skips (suites condicionais nao executadas por esse comando). Integracao T09 independente em PostgreSQL Docker descartavel: 8/8; unitarios direcionados adicionais passaram. Painel lint/build e suite integral aprovados (contagem final registrada apos refinamentos de QA). BrowserOS com sessao normal do usuario comprovou salvar formulario e transicoes com AlertDialog. Nenhuma migration Neon, commit, push ou deploy.

Runtime local: API e painel reconstruidos de runtimes locais anteriores, copiando somente dist/database (API) e dist (painel), sem .env/chaves em imagem. Dependencias nao mudaram na API neste incremento. Contexto do painel deve normalizar diretorios para 755 e arquivos para 644; uma tentativa com permissao restrita causou403 e foi substituida. API iniciou com runner/seed idempotentes do Compose existente. Institucional e PostgreSQL nao foram recriados; volumes preservados.

Limites obrigatorios: estado published/scheduled administrativo NAO distribui enquete no site. Sem worker ou ativacao automatica; agendada exige novo publish dentro da janela neste incremento. T10 voto/participacao, idempotencia/prova de visitante, consentimentos, moderacao operacional, snapshot publico sem SQL e UI do institucional continuam pendentes. A tabela de voto nao equivale a endpoint publico implementado. Fase3 parcial; nao publicar producao com estas lacunas.

### Fechamento do QA local

Smoke sintetico arquivado com versao4 (rascunho -> agendada -> encerrada -> arquivada); resultados consultados no BrowserOS retornaram0 votos/0% nas duas alternativas, sem inventar participacoes. Refinamentos do editor: Select por nome para usuarios com program.read, loading/erro/vazio explicitos; ID manual apenas para perfil sem esse acesso. Corrigida versao visual/snapshot apos transicao quando formulario limpo, preservando edicao pendente e bloqueando transicoes ate salvar/descartar explicitamente. Testes de regressao dessas condicoes incluidos:28de enquetes,113totais no painel, lint/build aprovados. Aviso de bundle principal>500kB permanece. Dispositivos fisicos/Safari e integracao publica continuam pendentes.

## 11/11/2026 - T11: Participacoes privadas e moderacao local

Aceite expresso do usuario: Table com filtros e Sheet para leitura e estados revisada/selecionada/rejeitada sem modificar fala original. Implementado somente no candidato local.

### Entrega

- API: GET /api/admin/participations com filtros programa/enquete/estado/cursor, GET detalhe e PATCH /:id/moderation. DTO privado, sem telefone/email. participation.read do modulo e participation.moderate independentes (chave de leitura correta: participation.read); acao exige ambas no programa autorizado, vinculo vigente quando participation, DENY/sessao/versao rechecados sob lock. Nenhum POST de coleta publica, DELETE ou PATCH de conteudo.
- Migration0022 adiciona radio_program_participation com FKs compostas radio/programa/edicao/enquete, limites e trigger de imutabilidade do original/origem. Atualizacoes exigem versao seguinte e estado moderado; nunca retornar received. Nota omitida preserva, string vazia limpa explicitamente. Auditoria somente ator/IDs/estado/versao, nao texto/nome/nota.
- Painel /participacoes: filtro por nomes quando permitido, estado, enquete, tabela e paginacao; Sheet privado com texto literal, nome declarado, programa/edicao, nota separada e estados. AlertDialog para selecionar/rejeitar; Sonner para feedback. Nenhum alert/confirm/prompt nativo novo. Navegacao/Acessos incluem recurso sem ampliar concessoes globais por conveniencia.
- Cache: texto/nota removidos do cache da tabela; detalhe/mutacoes cancelados e descartados ao fechar/sair/perder acesso. Resposta tardia nao recoloca dados privados. Atualizar fecha Sheet antes da nova consulta, inclusive lista200vazia apos perda de vinculo. Foco restaurado ao abridor ou botao Atualizar. Sem polling/refetch por foco/reconexao; revogacao remota e percebida na requisicao seguinte, nao promessa de limpeza instantanea sem comunicacao.

### Evidencias

- API typecheck/build aprovados. Suite geral197aprovados/61skips; estes skips sao suites condicionais, nao aprovacao delas. Teste direcionado reproduzivel sh api-ouvintes/scripts/test-participation-admin.sh:18aprovados (5unitarios+13integracoes), PostgreSQL16 Docker descartavel com nome_test/loopback, credenciais sinteticas e dotenv desabilitado; runner executado2vezes sem duplicacao. Sem uso do banco persistente nessa suite.
- Integracao testa dois programas/locutores, grant moderate sem read/poll.read, scopes mistos, DENY, vinculo expirado/revogado sob lock, sessao revogada sob lock, concorrencia200409 e uma auditoria, FKs cruzadas/trigger de imutabilidade, no-store em erros, ausencia de criacao/DELETE/flagfalse e nenhuma publicacao/S3. Nao houve captura de logs reais de producao; logger fica desligado no NODE_ENVtest.
- Painel:148testes aprovados,35especificos de Participacoes; lint/build e diff-check aprovados. Inclui respostas GET/PATCH tardias, cache, imutabilidade, conflitos, notas, sem polling, foco e erros de acesso. Aviso do bundle principal>500kB permanece.
- Migration0022 aplicada somente ao Docker radio88_feed_preview pelo runner, apos backup privado /tmp/radio88-before-participations.31bGBX. Sentinelas preservadas3usuarios/12programas/44horarios/1enquete;0votos. API/painel recriados com runtimes locais e bundles atuais, sem chaves em imagem; PostgreSQL/institucional/volumes mantidos.
- BrowserOS: lista vazia conferida antes da fixture. Criada1opiniao sintetica identificada Teste local (sintetico), id200b7e56-4f42-4c96-86f0-838e47dc8573, ligada apenas a enquete sintetica local arquivada da validacao anterior. OrigemSQL exclusiva do smoke, nao comprova intake/consentimento publico. Revisada->Selecionada, versao3 e2auditorias; original/nota preservados,0votos. Estado permanece selecionado para avaliacao visual, nunca publicado.
- Limitacao do smoke: aba BrowserOS em background nao recebeu cliques nativos consistentemente. Abertura e confirmacoes foram acionadas pelo mesmo botao DOM via evaluateInPage apenas apos diagnostico; campos/select usados via ferramentas UI. Renderizacao, feedback e persistencia foram conferidos; nao declarar QA real de mouse/teclado/dispositivos concluido por esse smoke. Testes de componente cobrem teclado/foco; validar manualmente na aba ativa e Safari/mobile fisico.

### Estado e proximos gates

T11 administrativo parcial utilizavel localmente. T10/T12 continuam pendentes: prova/idempotencia do visitante, votos, formulario publico/consentimentos, politica lexical integrada, snapshot sem SQL e E2E institucional. Nome declarado nao e conta verificada. Nao ha exportacao/telefone/CRM nem publicacao de opinioes. Retencao/expurgo ainda requer decisao; nenhuma exclusao automatica.

Sem commit, push, Preview, Production, Neon ou alteracao de objetos R2. Aprovar o proximo incremento publico separadamente. Ver adr-007-03-moderacao-privada.md, participation-admin-contract.md e validacao-participacoes-local.md.

## 11/11/2026 - Revisao de produto e fluxo publico LOCAL

Decisao expressa substitui moderacao obrigatoria: mensagens pertencem a enquete e ficam visiveis diretamente a equipe com participation.read. Sem bloqueio lexical automatico neste recorte; locutor decide o que le no ar. Original privado/imutavel, limites/rate limit e acesso por programa continuam. Historico e endpoints administrativos legados preservados; workflow de aprovacao retirado da UI.

Painel: Enquetes concentra lista mais legivel, editor com slug assistido pela pergunta e alternativas numeradas, modos vote/message/mixed, imagem URL e workspace /enquetes/:id/resultados com abas de resultados/progressbars e mensagens nome/bairro. /participacoes redireciona /enquetes. Leitura de votos e de mensagens com permissoes independentes. 140testes/lint/build aprovados; QA visual autenticado desta revisao aguarda login local do usuario.

API: migration0023 preserva allow_message antigo ao derivar modo legado, recibos/dedupe, vinculo a listener_profile/device existentes e bairro privado imutavel. Identidade apenas por posse de token opaco existente (HMAC DEVICE_TOKEN_SECRET), nunca lookup/merge/revelacao por telefone sozinho. Mesmo dispositivo reconhecido sem recadastro; outro aparelho exige recuperacao futura. Identificacao declarada nao e identidade verificada. Sem marketing automatico. Envio anonimo nao cria perfil; mensagem pode existir sem voto no modo message. Voto+mensagem atomicos no modo mixed, privacy version poll-privacy-v1 e aceite gravados, recibo idempotente e conflito de payload. Exigir published e janela/grade vigentes no servidor; agendamento nao basta. Encerramento retira do snapshot.

Ponte publica exclusiva LOCAL: POLLS_PUBLIC_LOCAL_ENABLED exige banco local, sem Vercel e NODE_ENV nao production. Snapshot arquivo /tmp/radio88-polls-local.json, publicado explicitamente; GETs nao consultam SQL, sem fallbackDB nem pollingSQL. Esta ponte nao e publicacao R2/CDN/Vercel pronta. No Docker override NODE_ENV development e comando unset VERCEL_ENV antes de iniciar runner/seed/server, pois o arquivo privado reaproveitado herdava VERCEL_ENVpreview; tentativa inicial bloqueada corretamente pela guarda. Nao relaxar essa guarda para publicar. Recriar container perde arquivo /tmp; republicar snapshot explicitamente.

Migration0023 aplicada somente PostgreSQL Docker apos backup /tmp/radio88-before-public-polls.WQfmEv e21testespublicos aprovados em PostgreSQL descartavel. Sentinelaprevia3usuarios/0perfis/12programas/44horarios. Fixture local c91547c3-d42f-41fc-967a-32ca746bf61a, slug enquete-doramas-demonstracao-local, arte enviada pelo usuario em institucional/public/polls/enquete-doramas.png. Associada para demonstracao somente a Temperatura Gospel na janela real local11/11 13h-15h (Brasilia); nao afirmar que o tema pertence oficialmente ao programa. FixtureSQL e snapshot gerado pelo servico local, nao por sessao artificial do painel. Sem toque em Neon/R2/producao.

BrowserOS confirmou CTA PARTCIPE DO PROGRAMA na Home(local), formulario com imagem/RadioGroup/identificacao/opiniao, envio identificado real na API local e estado de sucesso. Banco confirmou1perfil/1recibo/1voto novo, mensagem Ouvinte teste local — Bairro de teste no estado received sem aprovacao;3usuarios/12programas/44horarios preservados. Reconhecimento apos reload no mesmo dispositivo comprovado sem novo cadastro. Dados100%sinteticos e telefone ficticio nao usado para contato. Painel local voltou a login; solicitada ajuda humana, sem copiar token ou resetar senha. Validacao visual autenticada do workspace continua pendente.

Regressao institucional162aprovados/1falhaSEOpreexistente (logo padrao em todosospreviews vsartigosfeed); novos3testesformulario+8programacao passam, tipos/lintdirecionado/buildclient/SSR/prerender10rotas passam. Build mantém avisos bundle/Browserslist. Sem commit/push/deploy. Producao exige substituir ponte local por publicacao R2, revisar abuso distribuido/proxies, recuperaroutrodispositivo e QA mobile/Safari/ciosidade/release. Limitacao antifraude: dedupe por dispositivo nao impede trocar dispositivo/token; nao afirmar uma pessoa=umvoto sem identidade verificada.

Fechamento: regressao API207aprovados/72skips e typecheck aprovados apos ajuste apenas de tipo ProcessEnv no teste de guard;21testespublicos direcionados aprovados. Prerender final do institucional precisou executar com permissao de pipe local do tsx e passou10rotas/404; imagem final atualizada. Demo encerra11/11/2026 as15hBrasilia, por regra real da edicao. Link http://127.0.0.1:8086/enquetes/enquete-doramas-demonstracao-local . Nao estender janela fora da grade por conveniencia; para outro horario criar/publicar outra enquete na edicao adequada.

### 11/11/2026 - Conferencia autenticada apos login do usuario

BrowserOS local confirmou /enquetes/c91547c3-d42f-41fc-967a-32ca746bf61a/resultados com sessao normal do usuario. Aba Resultados: total1voto, Sim1/100%, Nao0/0%, progressbars presentes. Aba Mensagens: Ouvinte teste local — Bairro de teste, horario11/11 14:23 e texto sintetico enviado no institucional; sem editar/aprovar/rejeitar. Sidebar tem Enquetes, sem Participacoes apartado. Screenshot desktop conferida e aba Mensagens deixada aberta para usuario. Nenhum voto/cadastro/papel/publicacao foi criado ou modificado nesta conferencia. Um clique nativo da automacao nao mudou a aba; foco+Enter funcionou. QA de dispositivo fisico/mobile/Safari e rollout seguem pendentes; a pendencia de login para conferencia desktop deste workspace foi resolvida.
