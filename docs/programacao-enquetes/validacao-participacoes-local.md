# Validacao local - Participacoes privadas

## Escopo deste aceite

Table com filtros e Sheet para leitura/moderacao. Este incremento administrativo nao habilita recebimento publico, nao importa Instagram e nao cadastra ouvintes automaticamente. A prova de visitante, idempotencia do envio, votos, consentimentos e formulario institucional permanecem no T10/T12. Nunca tratar fixtures como metricas reais.

## Preparacao segura

- Usar somente projeto Docker radio88-feed; API3012/painel5181/institucional8086 e PostgreSQL local. Nao usar DATABASE_URL do Neon ou Preview.
- Migration seguinte a0021 deve passar primeiro em PostgreSQL descartavel com nome _test, pelo runner existente. Nao usar a suite de integracao no banco persistente.
- Antes da aplicacao local: backup privado e contagem sentinela de usuarios/programas/horarios. Nao apagar volumes, nao recriar contas, nao resetar senha e nao tocar objetos R2.
- POLLS_ENABLED controla o dominio administrativo, desligado por padrao fora do override local.
- Dados sinteticos somente no banco local, identificados como teste e sem nome/telefone de pessoa real. A fixture deve ficar separada de resultados reais, sem criar votos.

## Conferencia visual

1. Acessar http://127.0.0.1:5181/participacoes com login normal. Se nao houver permissao, menu e rota nao devem permitir a consulta.
2. Conferir estado vazio sem inventar mensagens. Carregamento usa Skeleton; falha tem erro amigavel e tentativa manual.
3. Filtrar por programa, estado e enquete conforme permissoes disponiveis. O filtro deve operar sobre registros autorizados, nao sobre uma lista global que vaze dados.
4. Abrir uma participacao sintetica em Sheet. Mostrar programa, pergunta, edicao, nome declarado ou Nao informado, texto original e estado. Nome declarado nao e identidade verificada.
5. Conferir leitura de texto com quebras de linha e caracteres HTML tratados como texto, sem executar scripts nem renderizar HTML recebido.
6. Com participation.moderate, marcar revisada, selecionada ou rejeitada. Confirmacoes usam componentes/Sonner, nunca alert/confirm/prompt. O original nunca fica editavel.
7. Reabrir e conferir persistencia, versao e nota interna. Repetir em outra sessao para provocar409: nao sobrescrever nem desfazer o trabalho alheio.
8. Fechar Sheet e testar consulta a outro registro; nao pode aparecer conteudo anterior como se fosse atual. Logout/perda de acesso/401/403/404 limpam o conteudo privado do cache da area.
9. Usar teclado: abrir registro, navegar acoes, Escape fecha e devolve foco. Em largura mobile Sheet/tabela nao devem cortar controles; tabela pode ter scroll horizontal localizado.
10. Permanecer ocioso e comprovar ausencia de refresh periodico de Participacoes; Atualizar consulta explicitamente. Sem worker/timer novo no backend.

## Conferencia de autorizacao e integridade

- participation.read e participation.moderate sao independentes. Moderate sem read nao permite obter o texto por PATCH. Vinculo sozinho nao e permissao.
- Dois locutores em programas diferentes: lista, filtros e IDs diretos nao atravessam vinculos; revogar vinculo/grant/usuario/sessao afeta a proxima requisicao.
- Override DENY prevalece; escopo participation nao equivale a global. Mostrar/opinar nao concede exportacao ou telefone completo.
- Nota/moderacao nao pode editar mensagem, displayName, programa, enquete, edicao ou voto. Payload extra rejeitado.
- FKs compostas impedem misturar radio/programa/edicao/enquete. Concorrencia otimista retorna409; estado invalido retorna400/422 conforme contrato.
- Auditoria nao recebe mensagem, nome, nota, telefone ou token. Nada desta area vai a R2, snapshot publico ou analytics.

## Limites operacionais

Sem envio publico, a lista pode estar vazia ate teste sintetico controlado. Nao existe SLA de moderacao automatica. A politica de linguagem e uma primeira passagem lexical e ainda nao foi conectada ao recebimento publico. Mensagens civis divergentes nao sao ofensas por discordarem. Selecionar e uma marcacao interna, nao publicacao nem autorizacao automatica para divulgar dados pessoais.

A proposta de retencao do Plano007 ainda exige validacao; este incremento nao apaga dados automaticamente. Rollback da feature: desabilitar flag/remover menu no candidato, preservar tabelas e historico. Restaurar dump somente como procedimento excepcional previamente validado; nunca down -v.
