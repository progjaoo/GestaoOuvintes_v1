# Plano 009 - Parte 1: contrato e previa de eventos

Data: 16/11/2026. Estado: implementado localmente, aguardando aceite para a proxima parte.

## Entrega

Parser puro em `api-ouvintes/src/services/calendar-poll-parser.ts`, com entradas evento/source/schedule e saida discriminada preview/pending/canceled. Nenhuma importacao de app/env/cliente Google/banco, timer, rota nova ou publicacao. Reutiliza pollInput, pollWindow e assertConcreteEdition. Cadastro manual e rotas existentes nao foram alterados.

Source e schedule sao entradas confiaveis fornecidas pelo futuro backend, nunca dados vindos diretamente do browser/evento. allowedProgramIds deve ser resultado da autorizacao efetiva. Este parser nao autentica requests, nao constitui endpoint e nao substitui revalidacao transacional da fase 2. A origem/ID externo ficam fora do payload publico. Slug e candidato, nao reserva unicidade; fase 2 deve reservar slug e manter ID/slug estaveis nos updates.

- Titulo/contexto convertidos para texto, HTML de formatacao permitido; markup desconhecido/ativo/ambiguo fica pendente. Nao e sanitizador HTML generico: nenhum HTML deste parser deve ser renderizado com innerHTML.
- Bloco delimitado e legado final inequivoco; desconhecidos, duplicatas e blocos incompletos rejeitados.
- Sem alternativas e sem tipo explicito: message, mesmo que o default da fonte seja mixed. Vote/mixed explicito sem alternativas: pendente. Message com alternativas: pendente.
- Programa por ID padrao ou nome exato normalizado entre ativos autorizados; nomes ambiguos/sem escopo: pendente.
- Datas reais, offsets obrigatorios para dateTime; timeZone sem offset fica pendente neste incremento. Eventos mistos/multidias/recorrentes/tentative ficam pendentes.
- Dia inteiro usa a edicao concreta correspondente a data local do inicio em America/Sao_Paulo. Virada de meia-noite testada. Datetime usa janela integralmente dentro da edicao; nao trunca. Excecoes da grade validadas pelo resolver existente.
- Alternativas 2..10 conforme schema atual; duplicatas normalizadas por acento/case/espacos rejeitadas. Pergunta 3..500/contexto ate 2000/opcao ate 300; sem truncar silenciosamente.
- Cancellation com ID minimo e somente sinal de origem; nao cancela enquetes. Ownership/revisao/publicacao estao na fase de persistencia futura.
- Nada de download automatico de anexos/audio ou inferencia de Sim/Nao. Nenhum alerta JavaScript introduzido.

## Demonstracao reproduzivel

Fixture identificada `api-ouvintes/tests/fixtures/calendar-poll-sample.json`, inspirada no tema fornecido pelo usuario, com dados de programa/agenda sinteticos. Nao foi extraida do Google e nao comprova que essa agenda pertence ao Bom Dia 88.

Na pasta api-ouvintes:

```sh
./node_modules/.bin/tsx scripts/calendar-poll-preview.ts
./node_modules/.bin/tsx scripts/calendar-poll-preview.ts --html
```

O HTML e gerado a partir do resultado real do parser e escape de texto. Demonstracao temporaria: http://127.0.0.1:8095/, container separado `radio88-calendar-preview-part1`, porta vinculada somente a loopback; artefato estatico em /private/tmp/plan009-part1/index.html. Nao e tela de producao/CRUD no painel. Nao tem botoes de gravar/votar. Ao reiniciar o computador/container pode ser necessario regenerar o arquivo.

No exemplo: mensagem privada, identificacao opcional, nenhuma alternativa inferida, 09h30-12h de 16/11/2026, requiresReview=true. Essa data e fixture historica, nao janela atual de producao.

## Evidencias de validacao

Imagem Docker `radio88-calendar-parser-test:local`, target dependencies do Dockerfile da API. Testes em container descartavel com `--network none`, codigo montado read-only e sem .env real. Nenhum servico existente reiniciado, nenhuma migration/seed aplicada.

- 37 testes do parser aprovados.
- 75 testes direcionados (parser, poll-admin, poll-policy, programming-resolver, public-poll) aprovados.
- Typecheck e build da API aprovados no Docker.
- Regressao da API: 244 aprovados, 72 skips condicionais de integracao/compatibilidade. Nao afirmar execucao com PostgreSQL: esta parte nao precisa de banco.
- Primeira tentativa da regressao ampla falhou por variaveis obrigatorias ausentes; repetida com valores sinteticos e URL de banco inacessivel, sem segredos reais, passou. Log local: /private/tmp/plan009-part1/regression.log.
- BrowserOS abriu a demonstracao e confirmou texto/modo/horarios/aviso de nao-publicacao.
- npm ci da imagem apontou 10 vulnerabilidades existentes (7 moderadas/3 altas); nenhuma dependencia foi adicionada/atualizada. Triagem continua gate de release, nao houve npm audit fix.

## Cloud Console

Verificado pelo BrowserOS: sessao acessivel na conta 88Labs, projeto Mosaico Leads Repository (`mosaico-leads-repository`). Nao e um projeto identificado como Radio 88. Nao alterado, nenhuma chave ou cliente OAuth criado nesta parte. Confirmar projeto dedicado antes de fase 3; API key nao autentica agenda privada. OAuth, callback e segredo serao criados na fase correspondente, com autorizacao humana da conta quando exigida. Nao ativar billing nem trial por conveniencia.

## Proxima parte e gates

Aprovar esta previa antes da fase 2: persistencia idempotente, proveniencia/revisoes, conflitos e leases com fixtures em PostgreSQL descartavel. Sem Google nessa fase. Fase 3 conecta OAuth/read-only e agenda real. Programa padrao, calendarId e projeto Cloud real continuam pendentes. Infraestrutura hospedada e autopublicacao nao estao prontas nem autorizadas implicitamente por estes testes.
