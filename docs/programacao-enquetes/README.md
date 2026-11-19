# Programas, grade e No Ar - Plano 007

## Estado em 09/11/2026

Fase 2 em andamento. Incremento administrativo local utilizavel no Docker radio88-feed: http://127.0.0.1:5181/programas. Sem publicacao remota.

- Cadastro/edicao/ativacao de programas, slug unico e versao otimista.
- Grade semanal com criacao/edicao/ativacao de horarios, vigencia e conflito concorrente.
- Vinculos de locutores ativos, com inicio/fim e desativacao.
- Leitura restrita por permissao + vinculo vigente; gestao global especifica por acao.
- Simulador privado da grade semanal; timezone IANA, madrugada e fronteiras semiabertas.
- Menu Programas e grade, fallback de navegacao para locutores, catalogo RBAC e Acesso por tela integrados.
- Sonner e Dialog Genesis existentes; nenhum alert/confirm/prompt nativo novo.
- Flag PROGRAMMING_ENABLED desligada por padrao e ligada so na API local pelo override Compose.

## Documentacao

- [Decisoes de escopo, seguranca, tempo e custo](decisoes.md)
- [Contratos e dicionario de dados](contratos.md)
- [Painel Docker local](../local-rbac-docker.md)

## Validacao

Migration 0019 validada primeiro em PostgreSQL descartavel Docker e depois aplicada somente no banco persistente local. Backup /tmp/radio88-before-p007-0019.dump (privado; nao versionar). Sentinela de contagem/IDs/hashes/estado dos usuarios identica antes/depois. Nenhum usuario de producao importado.

Typecheck API aprovado. Grade/resolvedor: 17 testes unitarios. Integracao Docker valida CRUD, slug, locutor sem vinculo, revogacao do vinculo, duas radios, versao desatualizada e conflito concorrente. Painel: 57 testes, lint/typecheck/build aprovados. Total final da API: 158 aprovados e 32 skips; 6 cenarios de integracao novos executados no PostgreSQL descartavel.

Smoke BrowserOS: criado Programa de homologacao local (slug programa-homologacao-local), cadastrado horario segunda 05h00-09h30 a partir de 09/11/2026 e vinculado usuario ficticio de teste. Fixture apenas local, nao publicar. Vinculo nao alterou seus papeis/permissoes.

Lockfile da API corrigido minimamente com registro opcional @emnapi/runtime ausente; nenhuma versao ja travada foi atualizada. Build Docker original voltou a passar com npm ci. Nao executar npm audit fix automaticamente; triagem de vulnerabilidades existentes continua gate de release.

## Pendencias do primeiro incremento (superadas em parte abaixo)

T05 tem base administrativa implementada; completar matriz de QA e compatibilidade no candidato final. T06 parcial: falta persistencia/gestao de excecoes e QA visual mobile/teclado real. T07 (snapshot/outbox/R2/retry sem PostgreSQL publico) e T08 (Header/Home/Programacao no institucional) nao implementados neste incremento. Edicoes concretas e enquetes permanecem nos proximos incrementos conforme dependencias. Nao declarar No Ar publico nem Fase 2 completa.

Rollback local: desligar PROGRAMMING_ENABLED e reconstruir painel anterior; manter migration aditiva e historico. Restauracao de backup e ultimo recurso. Nao apagar volumes para voltar uma feature.

Simulador validado no BrowserOS apos correcao de type=submit: 09/11/2026 06h00 (horario local) retornou Programa de homologacao local em America/Sao_Paulo. Adicionado teste de regressao do envio. Os testes de dois locutores comprovaram listas separadas, 404 por ID fora de vinculo, expiracao e bloqueio de usuario inativo. QA visual mobile e testes legados condicionais continuam pendentes.

## Complemento local: imagem, nomes publicos, excecoes e institucional

Implementado e comprovado no BrowserOS em 09/11/2026:

- Criacao/edicao com nomes publicos dos apresentadores e imagem via multipart/R2, com preview e reutilizacao do asset em retry. Recomendacao: 1920 x 1080 px (16:9), JPEG/PNG/WebP/AVIF, ate 10 MiB; imagem processada/validada antes de disponibilizar.
- Nomes publicos independem das contas vinculadas: escrever um nome nao concede acesso. Vinculos continuam sendo gerenciados separadamente.
- Criacao de horarios em varios dias numa unica operacao atomica, visao semanal, edicao/ativacao de horarios, vigencia e conflitos.
- Excecoes persistidas: substituicao por programa ou interrupcao, intervalo UTC, motivo interno, ativacao e controle de versao. Excecoes prevalecem sobre recorrencia no simulador e no institucional.
- Publicacao explicita: salvar altera o administrativo; Publicar grade envia revisao imutavel e depois atualiza o ponteiro R2. Estado persistido permite tentar novamente; nao ha worker continuo.
- Header, secao No Ar na Home e /programacao compartilham um provider. O player inicia pausado como antes. Banner, locutores, Feed e card azul de programacao preservados.
- API publica le somente snapshot R2, nunca faz fallback PostgreSQL. Cache de memoria 15 s, HTTP 30 s, refetch cliente visivel 60 s; intervalo ocioso/aba oculta nao faz refetch. Snapshot valido por 30 dias; republicar antes de expirar.

### Evidencia real

Fixture Programa de homologacao local, com Locutor de teste e Apresentadora de teste. Upload da imagem publica de estudio podcast-banner.jpg (1920 x 1080) para bucket R2 de Preview, sem envio de dados pessoais. Mantido horario segunda 05:00-09:30 e criado lote segunda-sexta 14:00-18:00, vigente 09-13/11/2026. Publicacao retornou Revisao 3 / Publicada; imagem, nomes e horario apareceram no Header/Home/Programacao do institucional em http://127.0.0.1:8086. Dados sinteticos nao devem ser migrados a producao.

Migration 0020 validada em PostgreSQL descartavel e aplicada somente no banco Docker persistente apos backup privado /tmp/radio88-before-p007-0020.dump. Nenhuma migration remota. API: 166 aprovados, 32 skips; painel: 60 aprovados e lint/typecheck/build. Institucional: 159/160, com falha preexistente reproduzida tambem no checkout anterior em seoConfig.test.ts:34 (expectativa uniforme de og:image diverge do Feed). Oito novos testes No Ar aprovados, typecheck e build/prerender/SEO aprovados. Refinamentos finais de cache/auditoria e indicador por slot passaram novamente typecheck/build e testes unitarios publicos; nao houve nova execucao integral apos esses refinamentos.

### Pendencias atuais / gate de release

Fase 2 segue em validacao local: QA mobile/Safari/teclado real, ociosidade de 15 minutos, falhas e concorrencia em ambiente hospedado e rollout continuam pendentes. Corrigir/decidir separadamente a expectativa SEO preexistente e triar vulnerabilidades existentes antes de release. Edicoes concretas, enquetes e participacoes nao foram implementadas aqui. Nenhum commit, push, deploy ou acesso ao Neon nesta entrega.


## Ajuste de responsividade da tela administrativa

A página **Programas e Grade** foi reorganizada para evitar a composição rígida e a tabela semanal larga:

- Catálogo em cartões responsivos, com seleção e identificação visual do programa.
- Resumo do programa selecionado separado das áreas de edição.
- Grade semanal em cartões que se reorganizam conforme a largura disponível, sem exigir rolagem horizontal da página.
- Horários, locutores vinculados e ações dispostos em colunas no desktop e empilhados em telas estreitas.
- Formulário do programa, imagem, publicação e ações com alvos de toque e largura adequados para mobile.
- Mantidos o design Genesis, permissões, contratos de API e comportamento funcional existente.

Validação local do painel: `npx tsc --noEmit`, `npm run lint`, 62 testes (19 arquivos) e `npm run build` aprovados. A suíte de `ProgrammingWeek` cobre seleção de um programa pela grade e o estado sem horários. A conferência automatizada de breakpoints não substitui QA em dispositivos físicos.

## Inicio da Fase 3

Consulte [incrementos de enquetes e participacoes](fase-3-incrementos.md). T09 iniciada somente com nucleo puro/testes; CRUD, migrations, UI e publicacao ainda pendentes.

## Fase 3 - incremento administrativo local (11/11/2026)

T09 e telas de Enquetes integrados no Docker radio88-feed, porta5181. Fase3 segue parcial: votos/opinioes publicos e snapshot nao implementados. Confira limites e evidencias antes de testar:

- [Diario dos incrementos e testes](fase-3-incrementos.md)
- [Contrato administrativo de enquetes](poll-admin-contract.md)
- [Opiniao privada e politica inicial de linguagem](moderacao-opinioes.md)

### Proximo incremento aprovado: Participacoes privadas

- [ADR007-03 - operacao e privacidade](adr-007-03-moderacao-privada.md)
- [Roteiro de validacao local](validacao-participacoes-local.md)
- [Contrato de participacoes administrativas privadas](participation-admin-contract.md)

### Revisao de produto: enquetes integradas (11/11/2026)

[Decisoes atuais](../public-poll-request-changes.md) e [contrato publico local](public-poll-contract.md). A aprovacao obrigatoria foi retirada; documentos anteriores de moderacao sao historico. Modos vote/message/mixed, perfil por dispositivo e demo local; nao declarar rollout pronto.

## Integracao Google Agenda - Plano 009

[Parte 1: parser puro, demonstracao e testes Docker](plano-009-parte-1.md). Cadastro manual preservado; OAuth e importacao persistente ainda nao implementados.

[Parte 2a: staging privado, preparacao OAuth e limites](plano-009-parte-2a.md). 51 testes Docker aprovados; OAuth cliente preparado, ainda sem conexao/importacao real. Materializacao e historico editorial pendentes.

[Parte 2b: base OAuth local somente leitura](plano-009-parte-2b.md). PKCE, state de uso unico, RBAC e refresh cifrado; ainda sem consentimento real nem GET de eventos.

[Parte 3a: leitura Google e staging privado](plano-009-parte-3a.md). Cliente Calendar estritamente GET, allowlist, paginacao/syncToken, mapeamento explicito de varios programas e revisao privada. Docker descartavel: 64 testes, migrations repetidas, typecheck/build aprovados. OAuth real e interface administrativa ainda pendentes.

[Parte 3b: gestão visual da sincronização](plano-009-parte-3b.md). Tela integrada a Enquetes, OAuth/status, fonte somente leitura, Bom Dia 88 como padrão, sincronização manual e conferência privada. Painel: 142 testes, lint e build aprovados. API: 64 testes em Postgres descartável, migrations 0001–0026 repetidas, typecheck/build aprovados. OAuth real, leitura real do Calendar e migração no banco persistente não executados.

Consulte também o [progresso do Plano 009](progresso.md) para o estado atual, dependências e próxima etapa.
