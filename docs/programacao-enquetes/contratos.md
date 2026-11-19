# Contratos locais - Programas e grade

Somente com PROGRAMMING_ENABLED=true. Bearer/sessao administrativa, Cache-Control no-store. Contexto de radio interno, nunca controlado por JSON/URL. DTOs Zod strict rejeitam campos desconhecidos.

| Rota | Contrato | Acesso |
|---|---|---|
| GET /api/admin/programs?after=UUID | items (ate 100), nextCursor | program.read global ou participation com vinculo vigente |
| GET /api/admin/programs/:id | program, slots, hosts (sem telefone/email) | mesma regra por recurso; fora de escopo retorna 404 |
| POST /api/admin/programs | name, slug, description?, active?; 201 com programa | program.manage global |
| PATCH /api/admin/programs/:id | cadastro completo + version; incrementa version | program.manage global |
| POST /api/admin/programs/:id/slots | weekday 0-6 (domingo=0), startMinute/endMinute 0-1439, validFrom YYYY-MM-DD, validUntil?, active? | schedule.manage global |
| PATCH /api/admin/programs/:id/slots/:slotId | campos do horario + version | schedule.manage global |
| GET /api/admin/programs/:id/eligible-hosts | ID/nome de ate 100 usuarios ativos | program.host.manage global |
| PUT /api/admin/programs/:id/hosts/:userId | active, validFrom ISO com offset, validUntil ISO/null | program.host.manage global |
| GET /api/admin/programming/simulate?at=ISO | at, timezone, current null ou programId/name/source/sourceId | schedule.manage global |

Erros: 400 DTO/data invalida; 401 sessao invalida; 403 grant/escopo insuficiente; 404 programa fora de contexto; 409 slug duplicado, versao ou horario conflitante; 422 locutor inexistente/inativo ao vincular. Mudancas geram admin_audit_log com ator, recurso e estado alterado, sem senhas/tokens.

## Dados / migration 0019_radio_programming.sql

- radio_programming_scope: key PK, timezone IANA restrita ao contrato atual.
- radio_program: UUID, radio_key FK, name/slug/description/active/version, timestamps. UNIQUE radio+slug e radio+id.
- radio_program_slot: UUID, radio+program FK composta, weekday/minutos/datas/active/version, timestamps. CHECKs de duracao, faixas e vigencia. Indice parcial por radio/dia/vigencia.
- radio_program_host: PK radio+program+usuario, FK programa composta e admin_user existente, active/vigencia/timestamps. Indice parcial por usuario/radio/programa.
- Identidade, RBAC e auditoria existentes reaproveitados; migration adiciona permissoes/escopos idempotentes, sem modificar usuarios/senhas.

Nao existe endpoint publico, snapshot R2 ou voto neste contrato inicial. Proximo incremento completa excecoes, publicacao e No Ar; nao usar o simulador privado como API publica.

## Extensao 0020 - Contratos em vigor no Docker local

A declaracao de ausencia de endpoint publico acima descreve somente o primeiro incremento.

| Rota/campo | Contrato | Autorizacao |
|---|---|---|
| POST/PATCH /api/admin/programs | presenters: nomes publicos; imageAssetId: UUID/null; PATCH mantem version | program.manage global; asset pronto, proprio ou ja vinculado ao mesmo programa |
| POST /api/admin/programs/assets | multipart imagem, max 10 MiB; retorna asset pronto para associar ao programa | program.manage + media.upload globais; publicacao habilitada |
| POST /api/admin/programs/:id/slots/batch | lote de dias/horarios, valida conflito e grava tudo ou nada | schedule.manage global |
| GET /api/admin/programming/weekly | grade semanal administrativa | schedule.manage global |
| GET/POST/PATCH /api/admin/programming/overrides[/:id] | substituicao/interrupcao, startsAt/endsAt UTC, motivo interno, active; PATCH exige version | schedule.manage global |
| GET /api/admin/programming/publication | ultima revisao, estado/tentativas/erro seguro | programming.publish global |
| POST /api/admin/programming/publish | gera/publica snapshot atual | programming.publish global e sessao revalidada |
| POST /api/admin/programming/publications/retry | tenta publicacao pendente/falha pelo fluxo administrativo | programming.publish global e sessao revalidada |
| GET /api/public/programming/config | snapshot publico strict, ETag/304, cache 30 s; erro cache 5 s | sem autenticacao; somente R2, sem SQL |

Contrato publico schemaVersion=1: radioKey, namespace, revision, generatedAt, validUntil, timezone, programs, slots e exceptions. Programas incluem somente identificadores publicos, nome, descricao, imagem e nomes de apresentadores; contas internas, motivos e PII nao integram contrato.

Migration 0020_programming_media_publication.sql: adiciona presenters JSONB e image_asset_id em radio_program; cria radio_program_override e radio_programming_publication; reutiliza media_asset, auditoria e identidade. Adiciona programming.publish somente para administracao global; nao amplia papeis antigos por conveniencia. Segue mecanismo db:migrate; nao editar 0019 nem usar push de schema.
