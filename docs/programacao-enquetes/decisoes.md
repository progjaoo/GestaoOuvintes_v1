# ADR 007-01 - Primeiro incremento de programas e grade

Status: implementado e validado apenas localmente, 09/11/2026.

## Escopo e compatibilidade

O candidato Feed/RBAC nao possui as tabelas tenant/perfil/Clerk da outra linha de trabalho. Adotado contexto de deployment explicito `radio-88` (constante backend PROGRAMMING_RADIO), permitido pela ponte do Plano 007. Nao importar migrations 0007-0012 nem conceder tenant por parametro do cliente. `radio_programming_scope` delimita as FKs compostas. Isso NAO constitui isolamento multitenant da identidade administrativa: futuras varias radios no mesmo deployment exigem vinculo radio/usuario e ADR propria.

## Autorizacao

Novas permissoes: program.read, program.manage, schedule.manage, program.host.manage. Admin recebe global para estas capacidades novas; os papeis anteriores nao recebem acesso aos dados de programas por conveniencia. Locutor recebe somente program.read em participation; leitura exige vinculo ativo e vigente com o programa. DENY continua prevalecendo pelo carregamento central de autorizacao. Vinculo sozinho nao concede permissao. O usuario deve estar ativo e a sessao valida. Listas, detalhes e IDs diretos aplicam o mesmo filtro. Candidatos a vinculo retornam somente ID/nome de contas ativas, exigindo program.host.manage global; limite 100 neste incremento.

Mutacoes exigem grant global especifico e revalidam usuario, versao e sessao na transacao. Advisory lock de identidade segue a ordem dos administradores existentes; lock da linha de radio serializa mutacoes da grade. PATCH exige version, com 409 para estado desatualizado. Horarios ativos reservam espaco mesmo se o programa estiver inativo (reativar um programa nao pode introduzir conflito oculto). Desativar o horario libera o espaco. Nao ha exclusao fisica nem reescrita de migrations anteriores.

## Tempo

America/Sao_Paulo, intervalos [inicio,fim), recorrencia por dia da semana e minutos locais. Fim menor que inicio significa madrugada; inicio igual ao fim e invalido. Datas de vigencia inclusivas referem-se ao dia de inicio. Comparador combina semana circular e vigencia, com janela representativa de 16 dias: os padroes se repetem em 7 dias, incluindo deslocamento da madrugada. Validacao ocorre sob lock antes da escrita. Datas de vinculo sao instantes com offset; UI usa horario local do dispositivo e envia UTC. API de simulacao e privada, nao e relogio de autoridade para votos.

## Custo e flags

PROGRAMMING_ENABLED=false por padrao; override compose.programming-local.yaml liga somente API local. Sem timers de polling, cron, SSE, worker ou nova rota publica. Simulacao consulta PostgreSQL apenas por comando administrativo. Banner, Feed, player e R2 nao foram modificados. Snapshot publico sem SQL e publicacao resiliente pertencem ao proximo incremento (T07).

## Pendencias explicitas

Excecoes de grade persistidas e respectiva UI (o resolvedor puro ja suporta excecoes, mas o simulador deste incremento usa apenas a grade semanal); edicoes concretas; imagens de programa; calendario visual avancado; QA mobile/navegadores reais; Snapshot/outbox/R2; No Ar no institucional; enquetes e participacoes. Nada disso deve ser declarado pronto por existir uma tela de programas.

## ADR 007-02 - Publicacao local explicita e consumo publico sem SQL

Status: implementada localmente em 09/11/2026; atualiza o escopo restrito da ADR 007-01, sem declarar rollout.

Imagem de programa e midia publica institucional, nao anexo privado: upload usa bucket radio88-feed-preview-public e chave imutavel programs/preview/radio-88/UUID.webp. Nao ativar MEDIA_STORAGE_DRIVER global por conveniencia. PROGRAMMING_PUBLICATION_ENABLED e PROGRAMMING_NAMESPACE habilitam esse dominio, com guarda de namespace/bucket. O bucket privado editorial permanece separado. Magic bytes, processamento seguro, tamanho, propriedade e permissao media.upload + program.manage sao exigidos. A imagem ja e publica ao enviar; nao enviar conteudo confidencial. Metadados e auditoria sao gravados em transacao; falha de banco tenta remover o objeto enviado.

presenters armazena somente nomes de exibicao. radio_program_host controla identidade/autorizacao, sem exposicao no snapshot. Motivo de excecao e interno. Nenhum email, telefone, ID de conta ou vinculo interno e publicado.

Mutacoes enfileiram payload duravel na mesma transacao. A equipe publica/reexecuta sob comando autenticado, revalidado sob lock. Sem setInterval, cron ou trabalho pos-resposta serverless. Writers serializados escrevem documento de revisao imutavel antes de current.json; falha preserva ponteiro anterior. Estado failed permite retry administrativo, nao retry infinito. Tempo limite compartilhado de 6 s no upload dos documentos; avaliar latencia real antes de habilitar hospedado.

Leitura publica R2 sem SQL; ETag/304, cache memoria 15 s e HTTP 30 s. Cliente consulta em intervalos de 60 s somente visivel e resolve transicoes localmente; previsao de propagacao em ate aproximadamente 120 s em condicoes normais, nao SLA contra falhas de rede. Documento expira em 30 dias e exige republicacao. Ausencia/expiracao/erro resulta em estado neutro, preservando reproducao de audio. PROGRAMMING_ENABLED e VITE_ON_AIR_ENABLED continuam false por padrao. Mudanca foi ligada apenas no Docker local com bucket Preview.

Limites: a entrega nao cria scheduler de republicacao, executor continuo, CDN real de producao nem enquetes. A topologia hospedada e retencao de revisoes/assets exigem decisao operacional antes de release.
