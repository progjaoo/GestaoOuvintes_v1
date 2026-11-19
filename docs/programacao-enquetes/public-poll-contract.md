# T10 - Contrato publico de enquetes, somente local

Status: implementado no candidato local em 11/11/2026. Este documento supera as descricoes antigas de ausencia de intake e exigencia de filtro lexical. Nao habilita producao nem publica dados em R2. Sem aprovacao obrigatoria para receber mensagem: o locutor escolhe o que revisar/selecionar no fluxo privado existente.

## Runtime e limites

Configurar somente no override local da API, sem mudar ambientes remotos:

```dotenv
NODE_ENV=development
POLLS_ENABLED=true
POLLS_PUBLIC_LOCAL_ENABLED=true
POLLS_PUBLIC_LOCAL_SNAPSHOT_FILE=/tmp/radio88-polls-local.json
```

VERCEL_ENV deve estar ausente, nao vazio. A flag publica e false por padrao e exige POLLS_ENABLED=true. O guard rejeita NODE_ENV=production, qualquer VERCEL_ENV definido e banco cujo hostname nao seja localhost, 127.0.0.1, [::1], db, postgres ou host.docker.internal. O hostname do servico Docker local deve corresponder a essa lista. Continuar usando DEVICE_TOKEN_SECRET existente e estavel (fallback legado: JWT_SECRET); trocar o segredo perde o reconhecimento dos hashes existentes.

Sem arquivo configurado, o snapshot existe apenas em memoria e desaparece ao reiniciar. Com arquivo, leitura inicial valida JSON strict e escrita usa arquivo temporario + rename atomico, permissao 0600. Uma instancia escritora local; nao e mecanismo distribuido. Nao ha timer, worker, scheduler, polling, R2 ou fallback SQL nas leituras publicas. Nenhum .env, Compose ou Docker persistente foi alterado nesta entrega.

## DTO publico

GET /api/public/polls/active?programId=UUID retorna {poll: PublicPoll|null}. programId e obrigatorio. GET /api/public/polls/:slug retorna PublicPoll ou 404. Ambos leem somente arquivo/memoria, nunca PostgreSQL. Cache-Control: public,max-age=15. O institucional deve ainda comparar o programId com o programa atual do snapshot da grade antes de exibir o CTA.

PublicPoll: id, slug, programId, programName, question, context, mode, imageUrl opcional, identificationPolicy, allowMessage, options:[{id,text}], editionStartsAt, editionEndsAt, startsAt, endsAt. Datas ISO UTC. Nenhum estado administrativo, resultado, perfil, token, consentimento, bairro ou mensagem integra o snapshot.

Somente estado published e publicado. active exige janela [startsAt,endsAt); bySlug recusa snapshot expirado. scheduled nao aparece publicamente e nao aceita envio: publicar administrativamente dentro da janela e depois executar publish-public. Nao existe ativacao implicita.

## Edicao administrativa e modos

POST/PATCH administrativos existentes aceitam mode:'vote'|'message'|'mixed' e imageUrl opcional, URL absoluta http/https ate 2048 caracteres. Exemplo local permitido: http://127.0.0.1:8086/polls/enquete-doramas.png. A API nao baixa nem envia essa imagem ao R2.

- vote: alternativa obrigatoria; mensagem proibida; 2..10 alternativas distintas; allowMessage=false.
- message: mensagem obrigatoria; alternativa proibida; options:[]; allowMessage=true.
- mixed: alternativa obrigatoria e mensagem opcional; 2..10 alternativas distintas; allowMessage=true.

Mode e a autoridade: allowMessage e derivado no input/DTO e protegido por constraint. Compatibilidade de input sem mode: allowMessage=true -> mixed; false -> vote. Essa excecao preserva clientes antigos sem habilitar mensagens silenciosamente. A migration adiciona default mixed, mapeia cada linha preexistente pelo allow_message original e mantem false como vote. Novos INSERTs SQL sem ambos os campos usam mixed/true de forma coerente.

Apos qualquer voto OU mensagem, nao alterar pergunta, alternativas, modo, identificacao, imagem, contexto, slug, janela ou edicao. PATCH continua restrito a draft/scheduled e version otimista. A moderacao nunca altera o original.

## Publicacao explicita

POST /api/admin/polls/:id/publish-public, corpo {} ou ausente, retorna PublicPoll. Requer sessao atual e poll.publish global ou participation com vinculo vigente; DENY prevalece e fora do escopo retorna 404. Reutiliza locks/revalidacao administrativos, nao concede permissoes novas. Estado published grava snapshot; demais estados retiram esse ID. Slug colidindo com outra enquete publicada retorna 409, pois a unicidade administrativa e por programa, mas a URL publica usa somente slug.

close/archive/cancel retiram o snapshot local depois do commit, antes de responder. Em falha de arquivo apos commit, o estado administrativo ja foi alterado; corrigir o armazenamento e chamar publish-public para reconciliar. Nao prometer transacao distribuida SQL/arquivo ou retry automatico. Cache HTTP anterior pode sobreviver por ate 15 s. Submit sempre revalida banco e recusa enquete encerrada mesmo com snapshot antigo. Mudancas da grade nao republicam snapshots automaticamente; reconciliar por comando administrativo, e o CTA tambem depende do programa atual no institucional.

## Token e identidade

Nos POSTs publicos, header x-device-token usa o token forte legado de 64 hex criado por getOrCreateDeviceToken em listener-registration/storage.ts. Backend reutiliza requireDeviceToken e hashDeviceToken do public-session-service, HMAC SHA-256 com env.DEVICE_TOKEN_SECRET. Nenhuma exigencia de UUID para dispositivo; submissionId continua UUID. Nao quebrar o cadastro legado. O token e segredo bearer, nao identidade civil verificada.

POST /api/public/polls/:id/identity aceita exatamente um destes corpos strict:

```json
{}
```

```json
{"name":"Nome declarado","neighborhood":"Bairro","city":"Cidade","phone":"11999999999","privacyAccepted":true}
```

Retorna {known:false} ou {known:true,displayName,neighborhood}. {} apenas reconhece perfil ativo/nao apagado pelo token vinculado existente; nao cria perfil/dispositivo. Cadastro completo cria perfil e vincula o token, sem marketing. Se ja conhecido, reutiliza os dados existentes, sem sobrescrever nome/bairro/telefone. Telefone sozinho nao consulta, revela ou agrega perfis; dois tokens com mesmo telefone nao sao mesclados. Dispositivo revogado retorna 403, inclusive retry, e nunca e relinkado automaticamente. Perfil bloqueado/apagado nao e reconhecido nem substituido no mesmo token.

name: 2..160, neighborhood/city: 2..120 apos trim; telefone formatado ate 30 caracteres e 10..15 digitos normalizados. Sem controles nesses campos. Nome declarado e bairro retornados devem ficar apenas em memoria no frontend, nunca localStorage/sessionStorage/analytics. Persistir no cliente apenas o token legado, nao nome, telefone ou mensagem.

## Envio, consentimento e recibo

POST /api/public/polls/:id/submit aceita corpo strict:

```json
{"submissionId":"UUID","optionId":"UUID opcional","message":"texto opcional","identified":false,"privacyAccepted":true}
```

identified e obrigatorio. Para identificacao, exige perfil ativo vinculado ao token e privacyAccepted=true. identificationPolicy=required proibe anonimo; anonymous proibe identified=true; optional aceita ambos. Quando ha mensagem, privacyAccepted=true e obrigatorio mesmo no envio anonimo. Voto anonimo sem mensagem nao exige o campo. A UI pode exigir o checkbox em todos os envios.

Aceites completos de identity sao gravados por enquete/dispositivo; submissions com aceite guardam data do banco e versao estavel poll-privacy-v1. O aviso deve explicar: envio somente para esta enquete, sem autorizacao de marketing. Perfil novo tem marketing_opt_in=false; preferencias preexistentes nao sao alteradas. Nome/bairro sao snapshots privados imutaveis no recibo interno e na participacao identificada; telefone nunca entra em Participation/PublicPoll. Participation DTO administrativo ganha neighborhood opcional. Anonimo nao recebe perfil nem snapshots de nome/bairro, mesmo que o token ja seja conhecido.

Mensagem: trim, nao vazia, ate 4000 caracteres, quebras de linha/tab permitidos, sem NUL/controles indevidos. Texto literal, nunca HTML executavel; renderizar como texto. Palavroes nao bloqueiam nem sao filtrados nesta entrega. Leitura/selecao/rejeicao continuam privadas e humanas, sem publicacao automatica.

HTTP 200 para primeiro envio e retry identico:

```json
{"status":"accepted","submissionId":"UUID","pollId":"UUID","voteId":"UUID ou null","messageId":"UUID ou null","receivedAt":"ISO UTC"}
```

Recibo identico e estavel, inclusive depois de encerrada a enquete; dispositivo revogado continua bloqueado. HMAC do payload canonico (optionId, mensagem apos trim, identified, privacyAccepted com ausencia=false) e token sao comparados. Mesmo submissionId com payload/token diferente retorna 409 SUBMISSION_CONFLICT. Outra submissionId no mesmo poll/token retorna 409 POLL_ALREADY_SUBMITTED. Novo token nao e prova de pessoa nova; dedupe e por dispositivo, nao anti-fraude civil.

## Autoridade, abuso e privacidade

Transacao usa lock shared de identidade (881188,12), scope da grade FOR SHARE, enquete FOR UPDATE, lock por HMAC do token e dispositivo FOR UPDATE. Rele dados depois de aguardar locks, usa clock_timestamp(), exige published, programa ativo, janela atual, edicao concreta exata e grade/overrides atuais. Revalida novamente antes de escrever. Alternativa deve estar ativa e pertencer a enquete/programa/radio. Voto, mensagem, consentimento e recibo sao atomicos; qualquer falha desfaz todos.

POSTs: Cache-Control:no-store em sucesso/erro; limite 10 requisicoes/minuto por IP por rota, inclusive retries, body limit 24 KiB. 429 preservado pelo error handler. Reutiliza trustProxy existente; antes de qualquer rollout, restringir proxies confiaveis e definir protecao distribuida de abuso. Nao afirmar que limite em memoria por instancia impede rotacao de token/IP.

400 input/modo/alternativa/consentimento invalidos; 403 dispositivo revogado/perfil indisponivel; 404 enquete/snapshot/escopo ausentes; 409 estado/janela/dedupe/recibo/perfil requerido; 422 edicao invalida; 429 abuso. Erros inesperados publicos nao registram SQL, payload ou detalhe de erro. Headers bearer, mensagem, nome, telefone, cidade e bairro possuem redaction; serializer padrao remove corpos dos logs. Auditoria administrativa continua apenas IDs/estado/versao, sem PII. Nada deste intake envia dados a R2, marketing ou analytics.

## Migration e verificacao

Somente nova migration 0023_public_poll_intake.sql. Nao editar 0022 aplicada. Reutiliza listener_profile/listener_device existentes, adiciona modo/imagem, bairro imutavel, recibos/dedupe/FKs e consentimentos privados. Nao aplicar em banco persistente/remoto sem o fluxo de backup/aceite do main.

Executar sh api-ouvintes/scripts/test-public-polls.sh a partir do pai, ou sh scripts/test-public-polls.sh na API. Cria PostgreSQL16-alpine exclusivo, sem volume, porta loopback aleatoria, banco _test e credenciais sinteticas; dotenv desabilitado e R2 desligado. Aplica runner duas vezes e remove container/arquivo temporario no trap. Testa identidade legada, nao merge por telefone, revogacao, modos, consentimento, atomia, dedupe/recibo concorrente, payload alterado, janela/grade/lock, imutabilidade, snapshot sem SQL, close, escopo, rate limit, guard local, logs e preservacao da migration com linhas antigas false/true em schema transacional isolado.

Evidencias desta entrega: 11 integracoes publicas e 5 unitarios de contrato aprovados; 4 guards de runtime aprovados; teste de logs corrigido para exigir ausencia de todas as sentinelas e corpos vazios (serializer descarta campos em vez de escrever [REDACTED]). Rerun final desse teste fica com main. Regressao geral anterior: 202 aprovados/71 skips condicionais. Participacoes administrativas com 0023: 18/18 aprovados em outro Docker descartavel. Main confirmou typecheck/build. Nao chamar skips de integracoes aprovadas. Sem commit, deploy, Neon, migration persistente ou alteracao de R2; runtime/fixture/BrowserQA ficam com main.
