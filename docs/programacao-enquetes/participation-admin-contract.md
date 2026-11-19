# Participacoes - administrativo privado local

## Escopo

Somente backend administrativo, sob POLLS_ENABLED existente. Sem intake/rota publica, votos, endpoint de fixture, telefone, exportacao, R2 ou publicacao. Nenhuma mudanca de Docker/.env ou migration persistente. displayName e dado declarado e nao verificado; nao representa conta autenticada nem autoriza contato/marketing. O filtro participation-language-policy permanece independente e intocado; nao filtra retroativamente mensagens privadas nesta entrega.

## HTTP e DTO

Sessao administrativa vigente. Cache-Control: no-store inclusive erros. Rotas:

- GET /api/admin/participations?programId=&pollId=&state=&after= -> {items: Participation[],nextCursor: UUID|null}
- GET /api/admin/participations/:id -> Participation
- PATCH /api/admin/participations/:id/moderation {version,state:'reviewed'|'selected'|'rejected',note?:string} -> Participation

Filtros UUID opcionais; state received|reviewed|selected|rejected. Omitir filtros vazios. Ordenacao UUID crescente, ate 100 itens, cursor exclusivo. Nenhuma contagem global ou dado de recurso fora do escopo.

Participation: id,programId,programName,pollId,pollQuestion,editionStartsAt,editionEndsAt,receivedAt,state,version,displayName:string|null,message:string,moderatedAt:string|null,moderationNote:string|null. Datas ISO UTC. programName/pollQuestion sao valores atuais do cadastro associado, nao snapshots. O mesmo DTO e usado na lista/detalhe. Campos de conteudo retornam texto literal: renderizar como texto, nunca HTML. Sem telefone/email/identidade verificada no DTO.

PATCH e strict, rejeita campos extras e qualquer message/displayName/pollId. version inteiro positivo obrigatorio. note opcional, texto ate 500 caracteres; ausencia de note preserva a moderationNote atual sob lock; string vazia (ou somente espacos) limpa explicitamente para null; string nao vazia substitui a nota apos trim. Remoderacao entre os tres estados e permitida, inclusive mesmo estado com nova nota, incrementando version. Nunca retorna a received. 400 validacao, 401 sessao invalida, 404 ID ausente/fora do escopo, 409 versao antiga. Sem PATCH de conteudo/DELETE/POST de criacao.

## Autorizacao

participation.read e participation.moderate independentes de poll.*. Admin recebe ambos globais; announcer somente read participation. Moderate exige concessao explicita. List/detalhe exigem read; mutacao exige read E moderate. Cada permissao pode ser global ou participation + vinculo atual no mesmo programa/radio; nao basta possuir vinculo. SQL consulta grants e DENY atuais; DENY prevalece mesmo contra ALLOW/global. own/department nao concedem acesso aqui. Sessao/usuario ativos e authz_version atual obrigatorios.

Moderacao usa advisory lock compartilhado de identidade (881188,12), scope da programacao FOR SHARE e locks de usuario/sessao, depois linha da participacao FOR UPDATE. Reconsulta autorizacao apos esperar locks e antes de UPDATE. Tempo confiavel clock_timestamp() apos locks. Expiracao/revogacao de vinculo/sessao e DENY bloqueiam nova operacao. Locks seguem ordem existente; nao usa writer/publicador da grade.

## Migration 0022

radio_program_participation: radio/program/edition/poll obrigatorios e FKs compostas. Constraint adicional em radio_poll(radio_key,program_id,edition_id,id) permite FK que rejeita poll da edicao errada. Mensagem ate 4000 caracteres nao vazia; display_name opcional ate 160 caracteres nao vazio quando presente. Sem colunas de contato. Texto simples, sem processamento HTML. version, created_at, moderated_at e moderation_note ate 500. Trigger impede mudar id/radio/program/edicao/poll/mensagem/nome/created_at e exige incremento de versao, estado moderado e moderated_at em updates. Sem exclusao por API. Futuro intake deve validar linguagem, identidade, janela, consentimentos e abuso separadamente.

Auditoria registra apenas radio/program/edicao/poll/ID/estado/versao e ator/acao. Nao inclui mensagem, nome, pergunta da enquete ou nota. Selecionar nao publica conteudo no site nem enfileira snapshot. Retencao/expurgo e E2E/UI permanecem para decisao posterior.

## Validacao da entrega (11/11/2026)

- TDD: teste unitario inicialmente falhou por modulo ausente; apos implementar, 5/5 unitarios aprovados.
- PostgreSQL 16 Docker descartavel, banco participation_admin_test sem volume: 13/13 integracoes aprovadas (18/18 com unitarios). Runner existente aplicou 0001..0022; segunda execucao nao reaplicou migrations. Containers exclusivos do teste removidos pelo trap.
- Gates comprovados: DTO/filtros; paginacao 100+2 e nenhum cursor/contagem de dados fora de escopo; dois locutores/programas; somente read e somente moderate; poll.read sem acesso; scopes mistos por acao; vinculo expirado; DENY em cada permissao; remoderacao; 400 conteudo/estado/nota invalidos; concorrencia 200/409 com uma auditoria; revogacao de vinculo sob lock de grade e sessao sob lock de identidade; FKs cruzadas; UPDATE direto de mensagem/nome/origem/id/data rejeitado; received irreversivel; flag false -> 404; no-store em 200/400/401/404/409 das rotas administrativas; sentinelas privadas ausentes da auditoria; cliente S3 sem chamadas e nenhuma publicacao enfileirada; sem colunas de contatos.
- Typecheck, build e diff-check aprovados. Suite geral: 197 aprovados/61 skips; integracoes condicionais nao ligadas nessa execucao geral. Nao confundir skips com aprovacao.
- Limitacoes: NODE_ENV=test desliga logger; nao houve captura/prova de sanitizacao de logs de producao. Sem E2E/frontend, runtime persistente, intake publico, consentimento, classificacao de linguagem integrada, retencao/expurgo ou publicacao externa. Nome/nota/mensagem sao privados, texto literal; frontend deve escapar ao renderizar. Sem acesso ao Neon/R2, commit/push ou migration persistente.

Reproducao, a partir de api-ouvintes, com Docker local e imagem postgres:16-alpine ja disponivel:

```sh
sh scripts/test-participation-admin.sh
npm run typecheck
npm run build
```

O script cria exclusivamente container efemero de nome unico, porta aleatoria em loopback e banco _test; usa DOTENV_CONFIG_PATH=/dev/null, credenciais sinteticas, desliga storage/publicacao e remove o container no encerramento. Nao altera .env/Compose/servicos existentes. A suite integrada exige RUN_PARTICIPATION_TESTS=true, POLLS_ENABLED=true e guard de host local/nome _test. Migration 0022 persistente fica sob responsabilidade exclusiva do main apos aceite.

### Correcao de semantica PATCH da nota

Ausencia preserva; vazio limpa explicitamente. Regressao integrada primeiro reproduziu a perda da nota (falha esperada), depois validou remoderacao sem note preservando a nota e note vazio limpando, inclusive em GET posterior. Nao alterou migration, frontend ou banco persistente.

## Integracao local pelo coordenador

Em11/11/2026, apos18testes direcionados aprovados em PostgreSQL descartavel, a migration0022 foi aplicada somente ao radio88_feed_preview pelo runner. Backup privado /tmp/radio88-before-participations.31bGBX. Sentinelas preservadas:3usuarios/12programas/44horarios/1enquete. API local reconstruida com dist/database atuais e mesmas dependencias. A afirmacao anterior de ausencia de migration persistente descreve apenas a entrega isolada do subagente; esta secao a supera exclusivamente para o Docker local. Nenhum Neon/Preview/Production alterado.
