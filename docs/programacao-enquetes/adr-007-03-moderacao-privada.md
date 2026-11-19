# ADR007-03 - Operacao privada de participacoes

Status: desenho aprovado para implementacao local em11/11/2026; evidencias de conclusao no diario fase-3-incrementos.md.

## Contexto

O usuario aprovou Table com filtros e Sheet para ler opinioes e marcar revisada/selecionada/rejeitada. O T09 ja existe localmente. O T10 de recebimento publico ainda nao passou por implementacao e QA; nao antecipar a promessa de voto/consentimento/identidade permanente.

## Decisao

Incremento T11 administrativo separado: rota /participacoes no painel, API privada sob gate POLLS_ENABLED e tabela aditiva no dominio radio/programa/edicao/enquete. Nenhuma rota de criacao publica ou cadastro assistido por conveniencia. Envio futuro exige servico proprio com validacao de janela, linguagem, abuso, prova/idempotencia e consentimentos antes de criar registros.

Nome e declarado e opcional, nao identidade verificada. Nao coletar telefone ou credenciais neste incremento. Mostrar Nao informado quando ausente; nao chamar de Anonimo se houver nome declarado. A mensagem e imutavel no fluxo operacional. Nota e estado pertencem a moderacao; nao sao alteracoes da fala original. Nao existe exclusao fisica nem propagacao ao snapshot publico. Selecionada e marcacao interna, nao publica texto/nome e nao autoriza disparos.

## Autorizacao

participation.read para consultar. participation.moderate e read para alterar estado. Concessao de leitura nao da permissao de moderar, exportar ou ver telefone. Vínculo vigente com programa + grant participation limita o recurso; grant global e explicito. Todas as decisoes ocorrem no backend, incluindo listas/filtros/IDs/mutacoes. DENY, usuario/sessao e revogacao nao dependem de JWT antigo expirar. Revalidacao sob transacao em mutacoes. Fluxo nao altera papeis existentes para conceder acesso global a locutores.

## Privacidade e colaboracao

Respostas privadas no-store. Texto simples escapado por React; sem dangerouslySetInnerHTML, analytics, localStorage ou sessionStorage de opinioes/notas. Sheet fechado remove o detalhe do cache; saida da area/logout e erros de acesso descartam dados privados. Resposta atrasada deve ser cancelada ou descartada para nao recolocar conteudo no cache.

Atualizacao manual apos comando ou por Atualizar, sem polling/timers. Mudancas de permissao noutro navegador serao percebidas na requisicao seguinte; nao se promete apagamento remoto instantaneo de texto ja exibido sem canal de revogacao. Duas sessoes editando usam version e409: reabrir/atualizar e revisar, sem sobrescrita silenciosa.

## Auditoria e dados

Auditar ator, IDs, estado e versao; nao auditar mensagem, nome, nota ou token. FKs compostas protegem radio/programa/edicao/enquete. Migration nova pelo runner SQL existente, primeiro em PostgreSQL Docker descartavel e depois local com backup; nenhuma migration antiga editada. Sem merge Clerk/tenant ausente por efeito lateral.

Retencao de mensagens e proposta do Plano007 ainda precisa ser validada para envio real. Nao agendar expurgo ou guardar mensagens bloqueadas automaticamente. Testes sinteticos locais sao identificados no roteiro, nao sao metricas de audiencia.

## Consequencias

A equipe pode validar o workflow privado antes de abrir coleta publica. A lista inicial pode estar vazia; testes usam fixture SQL controlada exclusivamente local. Isso nao substitui o fluxo institucional Home->enquete->recibo->painel, ainda pendente. Produção deve continuar desabilitada para este incremento ate gates aplicaveis do T10/T12/T14.
