# PRD 003 - Plataforma de sorteios, campanhas, identidade de ouvintes e RBAC

Status: planejamento para aprovacao

Data: 2026-07-16

Projetos afetados:

- `GestaoOuvintes/api-ouvintes`
- `GestaoOuvintes/painel-adm`
- `radio-88-fm-institucional`
- futuro aplicativo React Native com Expo

Agentes considerados:

- Product Manager: regras de campanhas, participacao e perfis administrativos.
- Tech Lead / Arquiteto: separacao entre campanha, ouvinte, dispositivo e participacao.
- Backend API Engineer: contratos publicos, eventos e autorizacao.
- Database Engineer: schema PostgreSQL, indices, migracao e auditoria.
- Institutional Frontend Engineer: experiencia do modal e sincronizacao de campanha.
- Mobile First / Mobile Engineer: token por instalacao e contrato reutilizavel no Expo.
- Security Engineer: PII, tokens, RBAC, auditoria e LGPD.
- QA Engineer e Code Reviewer: regressao cross-project e criterios de aceite.
- DevOps / Release Engineer: SSE, proxy, cache, backup e observabilidade.

## 1. Resumo executivo

O institucional atualmente consulta uma campanha por `slug` fixo definido no build do Vite. Criar uma nova campanha no painel nao altera esse valor e, portanto, nao faz o site consultar a nova campanha. O problema nao e atraso do PostgreSQL: e uma incompatibilidade entre o modelo dinamico do painel e o contrato estatico do frontend.

Este PRD propoe:

1. substituir o slug fixo por uma publicacao de campanha em um `placement` conhecido pelo site;
2. atualizar o modal em tempo quase real via Server-Sent Events (SSE), com polling e refetch por foco como fallback;
3. criar identidade anonima por instalacao/dispositivo, sem fingerprint invasivo;
4. separar perfil do ouvinte de participacao em campanha/sorteio;
5. permitir que um dispositivo conhecido responda apenas "Sim, quero participar" em uma nova campanha;
6. criar gestao completa de sorteios, perfis, contatos e usuarios administrativos com RBAC expansivel;
7. manter contratos compativeis com o futuro aplicativo Expo.

## 2. Diagnostico confirmado do problema atual

### 2.1 Causa raiz principal

O institucional usa:

```env
VITE_LISTENER_REGISTRATION_CAMPAIGN_SLUG=lancamento-institucional-2026
```

O hook chama somente:

```text
GET /api/public/campaigns/lancamento-institucional-2026
```

A campanha nova criada no painel possui outro slug. No banco local, em 2026-07-16, foi confirmado:

- `sorteios-radio-88`: `active` e dentro do periodo;
- `lancamento-institucional-2026`: `closed`.

Logo, o site continua consultando a campanha encerrada e nunca descobre `sorteios-radio-88`.

### 2.2 Problemas secundarios

- A consulta do React Query possui `staleTime` de cinco minutos e nao possui `refetchInterval` explicito.
- O endpoint publico atual exige conhecer o slug antes da consulta.
- Nao existe conceito de campanha publicada/destacada para o local `institutional_modal`.
- A API permite mais de uma campanha `active` simultaneamente sem regra deterministica de qual deve aparecer.
- O cache HTTP do endpoint nao declara explicitamente `Cache-Control: no-store`.
- O frontend nao recebe eventos quando uma campanha e publicada, pausada ou encerrada.
- A configuracao `VITE_*` e incorporada no build; trocar campanha exigiria rebuild/redeploy.

### 2.3 Limitacao da identificacao atual

O `submissionToken` atual:

- e criado por campanha;
- serve somente para idempotencia de um POST;
- e removido do `localStorage` depois do cadastro;
- nao representa um dispositivo;
- nao representa uma pessoa;
- nao permite associar participacoes futuras ao mesmo ouvinte.

O marcador `completed.<slug>` apenas impede que o mesmo modal reapareca naquele navegador para aquele slug. Ele nao cria identidade reutilizavel.

### 2.4 Limitacao de usuarios e permissoes

O banco atual aceita apenas os papeis `admin` e `viewer`. Nao ha:

- CRUD administrativo de usuarios;
- multiplas funcoes por usuario;
- permissoes granulares;
- papel de recepcionista;
- papel de locutor;
- auditoria geral de operacoes administrativas;
- atribuicao e historico de contatos com ouvintes.

## 3. Objetivos

### 3.1 Objetivos funcionais

- Uma campanha publicada deve aparecer no institucional sem rebuild do frontend.
- Uma aba aberta deve detectar nova campanha em ate 30 segundos no fallback e imediatamente quando SSE estiver conectado.
- Cada instalacao web deve receber um token persistente e independente.
- Mobile web e desktop devem possuir tokens diferentes quando forem instalacoes/navegadores diferentes.
- Um dispositivo reconhecido deve poder participar de nova campanha sem preencher os dados novamente.
- Uma campanha ja concluida/participada nao deve reabrir para o mesmo dispositivo.
- O painel deve permitir publicar campanha, gerir sorteio, consultar participantes e administrar acessos.
- Recepcionistas devem cadastrar ouvintes e registrar contatos de WhatsApp conforme permissao.
- Locutores devem receber apenas as permissoes necessarias ao seu trabalho.
- O desenho deve ser reutilizavel pelo aplicativo Expo.

### 3.2 Objetivos nao funcionais

- Sem PII em analytics, URLs ou logs comuns.
- Token bruto de dispositivo nunca deve ser persistido no banco.
- Operacoes de sorteio devem ser auditaveis e reproduziveis.
- Banco deve evoluir por migracoes aditivas.
- Fluxo publico deve degradar de forma segura se SSE estiver indisponivel.
- Interface deve ser Mobile First e acessivel.

## 4. Fora do escopo desta entrega

- Reconhecer automaticamente a mesma pessoa em aparelhos diferentes sem login, OTP ou vinculacao manual.
- Usar fingerprint de navegador, canvas, IP ou user-agent como identidade.
- Enviar mensagens de WhatsApp automaticamente sem provedor e consentimento aprovados.
- Implementar o aplicativo Expo nesta fase.
- Remover imediatamente as tabelas e endpoints existentes.

## 5. Decisoes de arquitetura

### 5.1 Campanha atual por placement, nao por slug no build

Criar o conceito de `campaign_placement`.

Exemplos de `placement_key`:

- `institutional_modal`
- `institutional_hero`
- `expo_home_modal`
- `radio_app_home`

O frontend consulta o placement conhecido, e a equipe publica qualquer campanha nesse placement pelo painel.

Contrato recomendado:

```http
GET /api/public/placements/institutional_modal/campaign
```

Resposta ativa:

```json
{
  "placement": "institutional_modal",
  "version": 12,
  "campaign": {
    "id": "uuid",
    "slug": "sorteios-radio-88",
    "type": "sweepstake",
    "title": "Faca parte dos nossos sorteios",
    "description": "Cadastre-se e concorra a premios.",
    "privacyNoticeVersion": "2026-07-16",
    "privacyNoticeUrl": "/privacidade",
    "termsUrl": "/regulamentos/sorteios-radio-88",
    "startsAt": "2026-07-16T23:36:00.000Z",
    "endsAt": "2026-07-17T23:36:00.000Z"
  }
}
```

Sem campanha publicada:

```json
{
  "placement": "institutional_modal",
  "version": 13,
  "campaign": null
}
```

Regras:

- um placement aponta para no maximo uma campanha publicada por vez;
- publicar nova campanha substitui a anterior em transacao;
- campanha precisa estar `active` e dentro do periodo para ser entregue;
- `version` aumenta em toda mudanca que afeta a experiencia publica;
- resposta publica deve usar `Cache-Control: no-store, max-age=0`;
- o slug continua existindo para URLs e administracao, mas deixa de ser configuracao do build.

### 5.2 Atualizacao em tempo real com fallback

Solucao principal:

```http
GET /api/public/events?placement=institutional_modal
Accept: text/event-stream
```

Evento:

```text
event: campaign.changed
data: {"placement":"institutional_modal","version":13}
```

Ao receber o evento, o frontend invalida apenas a query do placement.

Backend:

- usar `LISTEN/NOTIFY` do PostgreSQL para propagar alteracoes entre instancias da API;
- emitir notificacao apenas depois de confirmar a transacao de publicacao;
- enviar heartbeat SSE para impedir encerramento silencioso pelo proxy;
- limitar conexoes por IP/origem de forma compativel com trafego real.

Fallback obrigatorio:

- fetch imediato no primeiro mount;
- `refetchOnWindowFocus: true`;
- refetch em `visibilitychange` quando a aba voltar a ficar visivel;
- `refetchOnReconnect: true`;
- polling de 30 segundos quando SSE estiver desconectado;
- backoff exponencial para reconectar SSE;
- nenhum polling enquanto a aba estiver oculta, exceto reconexao controlada.

Justificativa: SSE atende notificacao unidirecional com menor complexidade que WebSocket. O polling preserva operacao em proxies/hospedagens sem suporte confiavel a conexoes longas.

### 5.3 Identidade por instalacao/dispositivo

Criar um token opaco aleatorio de no minimo 128 bits por instalacao.

Web:

- armazenar token bruto em `localStorage` com schema versionado;
- classificar `web_mobile`, `web_desktop` ou `web_tablet` apenas como metadado;
- nao derivar token de user-agent, IP ou fingerprint;
- enviar token em header dedicado `X-Device-Token`, nunca em query string.

Expo futuro:

- armazenar o mesmo tipo de token em `expo-secure-store`;
- usar `expo_ios` ou `expo_android` como plataforma;
- consumir os mesmos contratos de sessao e participacao.

Servidor:

- armazenar somente `HMAC-SHA-256(token, DEVICE_TOKEN_SECRET)`;
- permitir rotacao/revogacao;
- atualizar `last_seen_at` com escrita limitada para evitar write amplification;
- token de dispositivo e reconhecimento de conveniencia, nao autenticacao forte.

Importante: um desktop e um celular terao tokens diferentes. Para consolidar os dois no mesmo perfil sera necessario, futuramente, telefone/e-mail verificado, login ou merge administrativo. Nao usar fingerprint para contornar essa limitacao.

### 5.4 Perfil, cadastro e participacao sao entidades diferentes

- `listener_profile`: dados atuais do ouvinte.
- `listener_device`: instalacoes conhecidas associadas opcionalmente ao perfil.
- `campaign_participation`: adesao de um perfil a uma campanha.
- `listener_registration`: registro historico legado/submissao original, mantido para compatibilidade e auditoria.

Fluxo anonimo:

1. dispositivo desconhecido consulta a experiencia publica;
2. modal exibe formulario completo;
3. API cria perfil, associa dispositivo e cria participacao em uma unica transacao;
4. frontend guarda apenas o token de dispositivo, nunca PII adicional.

Fluxo conhecido em nova campanha:

1. API reconhece `listener_device` e seu `listener_profile`;
2. se ainda nao participou, modal exibe: "Voce ja possui cadastro. Deseja participar deste sorteio?";
3. confirmacao chama endpoint de participacao sem reenviar nome/bairro/cidade;
4. se ja participou, modal nao abre e a API devolve estado `participating`.

Fluxo de dispositivo desconhecido para pessoa ja cadastrada:

- exibir formulario completo nesta fase;
- no futuro, oferecer vinculacao por telefone/e-mail com OTP;
- merge manual no painel deve exigir permissao e auditoria.

### 5.5 Estado do modal por campanha e dispositivo

Estados publicos:

- `anonymous_registration_required`
- `known_listener_confirmation_required`
- `already_participating`
- `campaign_unavailable`

O fechamento "Agora nao" deve ser por `device_id + campaign_id`, nao global.

O servidor pode persistir `dismissed_until` em `campaign_device_state`. O frontend tambem pode manter cache local para resposta imediata, mas a API e a fonte de verdade.

Uma nova campanha sempre possui novo `campaign_id`; portanto, o estado da campanha anterior nao bloqueia o modal novo.

## 6. Modelo de dados proposto

Todas as mudancas devem ser implementadas em novas migracoes, sem editar `0001_initial_schema.sql`.

### 6.1 Alteracoes em `campaign`

Adicionar:

| Campo | Tipo | Regra |
| --- | --- | --- |
| `type` | varchar(30) | `registration`, `sweepstake`, `engagement` |
| `public_version` | bigint | incrementado em mudanca publica |
| `created_by_admin_user_id` | uuid nullable | auditoria |
| `updated_by_admin_user_id` | uuid nullable | auditoria |
| `archived_at` | timestamptz nullable | arquivamento logico |

### 6.2 `campaign_placement`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | uuid | PK |
| `placement_key` | varchar(80) | unico |
| `campaign_id` | uuid nullable | FK para campanha |
| `version` | bigint | aumenta em publicacao/retirada |
| `published_at` | timestamptz nullable | data da publicacao |
| `published_by_admin_user_id` | uuid nullable | auditoria |
| `updated_at` | timestamptz | obrigatorio |

### 6.3 `listener_profile`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | uuid | PK |
| `name` | varchar(160) | obrigatorio |
| `neighborhood` | varchar(120) | obrigatorio |
| `city` | varchar(120) | obrigatorio |
| `phone` | varchar(20) nullable | opcional |
| `phone_normalized` | varchar(20) nullable | indice parcial, nao unico inicialmente |
| `status` | varchar(20) | `active`, `blocked`, `deleted` |
| `marketing_opt_in` | boolean | estado atual |
| `created_at` | timestamptz | obrigatorio |
| `updated_at` | timestamptz | obrigatorio |
| `deleted_at` | timestamptz nullable | exclusao logica |

Nao criar unicidade por nome/bairro/cidade. Telefone opcional tambem nao deve ser chave primaria. Duplicatas devem ser tratadas por merge auditado.

### 6.4 `listener_device`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | uuid | PK |
| `listener_profile_id` | uuid nullable | FK |
| `token_hash` | varchar(128) | unico |
| `platform` | varchar(30) | web/expo por plataforma |
| `first_seen_at` | timestamptz | obrigatorio |
| `last_seen_at` | timestamptz | obrigatorio |
| `linked_at` | timestamptz nullable | quando associado ao perfil |
| `revoked_at` | timestamptz nullable | revogacao |

### 6.5 `campaign_participation`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | uuid | PK |
| `campaign_id` | uuid | FK obrigatoria |
| `listener_profile_id` | uuid | FK obrigatoria |
| `listener_device_id` | uuid nullable | origem |
| `source` | varchar(50) | web, expo, receptionist, import |
| `status` | varchar(20) | `eligible`, `entered`, `withdrawn`, `disqualified` |
| `created_at` | timestamptz | obrigatorio |
| `updated_at` | timestamptz | obrigatorio |

Restricao unica: `(campaign_id, listener_profile_id)`.

### 6.6 `campaign_device_state`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `campaign_id` | uuid | FK |
| `listener_device_id` | uuid | FK |
| `first_seen_at` | timestamptz | obrigatorio |
| `last_seen_at` | timestamptz | obrigatorio |
| `dismissed_until` | timestamptz nullable | "Agora nao" |
| `modal_open_count` | integer | observabilidade sem PII |

PK composta: `(campaign_id, listener_device_id)`.

### 6.7 Sorteios

Tabelas:

- `sweepstake`: configuracao e regulamento do sorteio ligado a campanha;
- `sweepstake_prize`: premios e quantidade;
- `sweepstake_entry`: snapshot de participantes elegiveis;
- `sweepstake_draw`: execucao auditada;
- `sweepstake_winner`: vencedores, suplentes e status de contato;

`sweepstake_draw` deve registrar:

- algoritmo/versao;
- hash do snapshot de participantes;
- quantidade de elegiveis;
- data/hora;
- usuario executor;
- resultado;
- motivo de cancelamento ou novo sorteio;
- trilha de auditoria imutavel.

O sorteio deve ocorrer no backend usando CSPRNG. Nunca selecionar vencedor apenas no navegador.

### 6.8 Contato com ouvintes

Criar:

- `listener_contact_assignment`: responsavel atual pelo contato;
- `listener_contact_event`: tentativa, sucesso, sem resposta, numero invalido, opt-out e observacao;
- `listener_note`: anotacao restrita e auditada;
- `admin_audit_log`: acao, ator, recurso, data e metadados sem segredos.

## 7. Contratos da API

### 7.1 Experiencia publica

```http
POST /api/public/session/resolve
X-Device-Token: <token-opaco>
```

Body:

```json
{
  "placement": "institutional_modal",
  "platform": "web_desktop"
}
```

Resposta:

```json
{
  "placementVersion": 13,
  "campaign": {},
  "listenerState": "known",
  "experience": "known_listener_confirmation_required",
  "participation": null,
  "dismissedUntil": null
}
```

O endpoint deve aceitar dispositivo ainda nao persistido e cria-lo somente quando necessario ou por estrategia de write-throttling definida na implementacao.

### 7.2 Primeiro cadastro e participacao

```http
POST /api/public/listeners/register-and-participate
X-Device-Token: <token-opaco>
Idempotency-Key: <uuid-por-tentativa>
```

Cria perfil + vincula dispositivo + aceita privacidade + cria participacao em transacao.

### 7.3 Participacao de ouvinte conhecido

```http
POST /api/public/campaigns/:campaignId/participations
X-Device-Token: <token-opaco>
Idempotency-Key: <uuid-por-tentativa>
```

Nao recebe PII. Resolve perfil pelo dispositivo e cria participacao idempotente.

### 7.4 Fechar modal

```http
PUT /api/public/campaigns/:campaignId/device-state
X-Device-Token: <token-opaco>
```

Body:

```json
{
  "dismissedUntil": "2026-07-17T00:00:00.000Z"
}
```

### 7.5 Eventos

```http
GET /api/public/events?placement=institutional_modal
```

Eventos permitidos:

- `campaign.changed`
- `campaign.closed`
- `heartbeat`

O stream nunca deve enviar PII ou estado individual do ouvinte.

### 7.6 APIs administrativas novas

Campanhas e placements:

- `POST /api/admin/campaigns/:id/publish`
- `POST /api/admin/placements/:placementKey/unpublish`
- `GET /api/admin/placements`
- `GET /api/admin/campaigns/:id/summary`

Ouvintes:

- `GET /api/admin/listeners`
- `POST /api/admin/listeners`
- `GET /api/admin/listeners/:id`
- `PUT /api/admin/listeners/:id`
- `POST /api/admin/listeners/:id/merge`
- `POST /api/admin/listeners/:id/contact-events`
- `GET /api/admin/listeners/:id/participations`

Sorteios:

- `POST /api/admin/sweepstakes`
- `GET /api/admin/sweepstakes`
- `GET /api/admin/sweepstakes/:id`
- `PUT /api/admin/sweepstakes/:id`
- `POST /api/admin/sweepstakes/:id/freeze-entries`
- `POST /api/admin/sweepstakes/:id/draw`
- `POST /api/admin/sweepstakes/:id/redraw`
- `PUT /api/admin/sweepstakes/:id/winners/:winnerId/contact-status`
- `GET /api/admin/sweepstakes/:id/audit`

Usuarios e RBAC:

- `GET/POST /api/admin/users`
- `GET/PUT /api/admin/users/:id`
- `POST /api/admin/users/:id/roles`
- `DELETE /api/admin/users/:id/roles/:roleId`
- `GET/POST /api/admin/roles`
- `PUT /api/admin/roles/:id/permissions`

## 8. Autorizacao expansivel (RBAC)

Nao ampliar o enum atual de `admin_user.role`. Migrar para relacao N:N:

- `role`
- `permission`
- `admin_user_role`
- `role_permission`

Papeis iniciais:

### Administrador

Todas as permissoes, inclusive usuarios, funcoes, exportacao, sorteio e auditoria.

### Gestor de campanhas

- criar/editar/publicar campanhas;
- criar/editar sorteios;
- consultar participantes;
- sem gestao de usuarios, salvo permissao adicional.

### Recepcionista

- consultar ouvintes necessarios ao contato;
- cadastrar ouvinte;
- editar dados permitidos;
- adicionar participacao mediante consentimento;
- registrar tentativa/resultado de contato;
- sem exportacao em massa;
- sem executar sorteio;
- sem gerenciar usuarios.

### Locutor

Perfil minimo inicial:

- consultar campanha/sorteio publicado;
- consultar informacoes publicas e resumo sem telefone completo;
- visualizar resultado quando liberado;
- nenhuma exportacao ou alteracao de PII por padrao.

### Auditor/visualizador

- leitura de campanhas, estatisticas e auditoria conforme escopo;
- sem escrita.

Permissoes sugeridas:

- `campaign.read`, `campaign.create`, `campaign.update`, `campaign.publish`
- `listener.read`, `listener.create`, `listener.update`, `listener.merge`
- `listener.contact`, `listener.phone.read`
- `participation.create`, `participation.withdraw`
- `sweepstake.read`, `sweepstake.manage`, `sweepstake.draw`, `sweepstake.redraw`
- `registration.export`
- `user.read`, `user.manage`, `role.manage`
- `audit.read`

Todas as verificacoes devem ocorrer no backend. Ocultar botoes no painel e apenas UX.

## 9. Experiencia do institucional

### 9.1 Carregamento

1. gerar/ler `deviceToken` uma vez;
2. resolver sessao para `institutional_modal`;
3. renderizar conforme `experience`;
4. conectar SSE depois do primeiro fetch;
5. invalidar consulta quando a versao do placement mudar.

### 9.2 Modal de dispositivo desconhecido

Manter formulario atual:

- nome obrigatorio;
- bairro obrigatorio;
- cidade obrigatoria;
- telefone opcional;
- aceite de privacidade obrigatorio;
- marketing opcional.

### 9.3 Modal de dispositivo conhecido

Conteudo sugerido:

```text
Voce ja possui cadastro na Radio 88 FM.
Deseja participar deste sorteio?

[Quero participar] [Agora nao]
```

Nao exibir nome ou telefone se o endpoint publico nao precisar devolve-los. Pode usar saudacao neutra para reduzir exposicao de PII em dispositivo compartilhado.

### 9.4 Campanha ja participada

- modal nao abre automaticamente;
- uma acao futura "Meus sorteios neste dispositivo" pode exibir estado sem revelar PII;
- permitir confirmacao visual nao invasiva quando o usuario chega por link direto da campanha.

### 9.5 Storage web versionado

Substituir chaves fragmentadas atuais por um documento minimo:

```json
{
  "schemaVersion": 2,
  "deviceToken": "uuid-ou-token-aleatorio",
  "platform": "web_desktop",
  "lastPlacementVersion": 13
}
```

Nao armazenar nome, telefone, cidade ou bairro.

## 10. Painel administrativo

### 10.1 Dashboard

- campanhas publicadas por placement;
- cadastros/perfis novos;
- participacoes por campanha;
- contatos pendentes;
- sorteios proximos;
- alertas de campanha ativa sem placement ou placement sem campanha valida.

### 10.2 Campanhas

- separar `Salvar rascunho` de `Publicar`;
- exibir preview do modal;
- selecionar placement;
- validar conflito de periodo/publicacao;
- exibir versao publica e ultima publicacao;
- pausar, encerrar, duplicar e arquivar;
- mostrar em tempo real se o institucional recebeu a versao publicada.

### 10.3 Ouvintes

- lista por perfil, nao somente por submissao;
- historico de participacoes;
- dispositivos vinculados sem expor token;
- status de contato;
- cadastro manual pela recepcao;
- merge de duplicatas com preview e auditoria;
- mascaramento de telefone conforme permissao.

### 10.4 Sorteios

- cadastro de premio e regulamento;
- regras de elegibilidade;
- congelamento do snapshot;
- simulacao sem gravar vencedor;
- execucao real com dupla confirmacao;
- vencedores e suplentes;
- registro de contato/aceite/recusa;
- novo sorteio somente com motivo auditado;
- exportacao de ata/resultado.

### 10.5 Usuarios, funcoes e permissoes

- CRUD de usuarios;
- ativar/desativar acesso;
- atribuir varias funcoes;
- matriz funcao x permissao;
- visualizar permissoes efetivas do usuario;
- registrar alteracoes no `admin_audit_log`.

## 11. Plano de implementacao por fases

### Fase 0 - Correcao imediata da campanha dinamica

Objetivo: eliminar o incidente sem esperar toda a plataforma.

1. criar `GET /api/public/placements/institutional_modal/campaign` ou, temporariamente, `GET /api/public/campaigns/current`;
2. definir selecao deterministica e impedir ambiguidade;
3. adicionar `Cache-Control: no-store`;
4. remover dependencia de `VITE_LISTENER_REGISTRATION_CAMPAIGN_SLUG` no institucional;
5. configurar query para refetch em mount, foco, reconexao e polling de 30 segundos;
6. criar acao explicita `Publicar no institucional` no painel;
7. cobrir criacao/publicacao/pausa/encerramento em testes integrados.

Resultado: nova campanha publicada aparece sem rebuild e em ate 30 segundos para aba aberta.

### Fase 1 - Eventos em tempo real

1. criar `campaign_placement` e `version`;
2. publicar campanha em transacao;
3. adicionar PostgreSQL `LISTEN/NOTIFY`;
4. criar SSE com heartbeat;
5. invalidar React Query ao receber `campaign.changed`;
6. manter polling somente como fallback;
7. testar multi-instancia e reconexao.

Resultado: alteracao aparece imediatamente em abas conectadas.

### Fase 2 - Dispositivo, perfil e participacao

1. criar tabelas de perfil, dispositivo, participacao e estado do modal;
2. criar token versionado no institucional;
3. implementar `session/resolve`;
4. implementar primeiro cadastro transacional;
5. implementar confirmacao simplificada para ouvinte conhecido;
6. migrar gradualmente o modal atual;
7. preservar endpoint legado durante janela de compatibilidade.

### Fase 3 - Gestao de ouvintes e contatos

1. tela de perfis;
2. cadastro manual por recepcionista;
3. historico de contato WhatsApp;
4. atribuicao de responsavel;
5. merge auditado;
6. filtros e exportacoes sob permissao.

### Fase 4 - RBAC completo

1. migrar `role` simples para N:N;
2. criar permissoes e papeis iniciais;
3. aplicar middleware de permissao por endpoint;
4. criar gestao de usuarios/funcoes no painel;
5. adicionar testes de matriz de autorizacao;
6. remover dependencia do campo legado depois da compatibilidade.

### Fase 5 - Gestao e execucao de sorteios

1. criar schema de sorteios/premios/entries/draw/winners;
2. criar regras de elegibilidade;
3. congelar snapshot;
4. implementar sorteio CSPRNG no backend;
5. implementar auditoria e novo sorteio justificado;
6. criar telas e relatorio/ata.

### Fase 6 - Integracao Expo

1. criar adaptador de storage com `expo-secure-store`;
2. reutilizar `session/resolve` e participacoes;
3. testar upgrade/reinstalacao e rotacao de token;
4. adicionar vinculacao entre dispositivos por OTP em fase separada.

## 12. Estrategia de migracao dos dados atuais

- manter `listener_registration` intacta na primeira entrega;
- criar `listener_profile_id` nullable em `listener_registration` para ligacao gradual;
- registros com telefone normalizado podem ser candidatos a merge, nunca merge automatico irreversivel;
- registros sem telefone geram perfil individual por padrao;
- disponibilizar relatorio de possiveis duplicatas para revisao administrativa;
- criar participacoes retroativas apenas para a campanha original de cada registro;
- executar migracao em lotes com contagem antes/depois;
- manter backup e script de validacao.

## 13. Seguranca, privacidade e LGPD

- nao usar fingerprinting silencioso;
- token de dispositivo deve ser revogavel e armazenado como hash;
- `DEVICE_TOKEN_SECRET` deve ser separado de `IP_HASH_SECRET` e `JWT_SECRET`;
- CORS deve aceitar apenas dominios reais;
- SSE deve validar Origin;
- PII nunca entra em SSE, GA4, URL, query string ou logs de acesso;
- telefone deve ser mascarado por permissao;
- toda leitura/exportacao sensivel deve ser auditada conforme risco;
- adicionar politica de retencao, anonimização e exclusao;
- consentimento de marketing deve ser independente da participacao;
- regulamento do sorteio e versao aceita devem ser persistidos;
- dispositivo compartilhado nao deve receber nome/telefone em resposta publica por padrao.

## 14. Infraestrutura e operacao

### API em container/VPS

- proxy deve desabilitar buffering na rota SSE;
- timeout da rota SSE deve ser maior que o heartbeat;
- healthcheck separado do stream;
- PostgreSQL nao exposto publicamente;
- `LISTEN/NOTIFY` funciona entre instancias conectadas ao mesmo banco;
- definir limite de conexoes considerando SSE + pool SQL.

### Hospedagem serverless

Se a API for migrada para ambiente que nao sustenta SSE:

- manter polling com ETag/`If-None-Match`;
- considerar servico gerenciado de realtime somente se necessario;
- nao bloquear a entrega inicial por SSE.

### Observabilidade

Metricas sem PII:

- versao atual por placement;
- conexoes SSE e reconexoes;
- tempo entre publicacao e leitura no institucional;
- modais abertos/dispensados;
- cadastros novos;
- confirmacoes de ouvintes conhecidos;
- erros por codigo;
- participacoes por campanha;
- sorteios executados e contatos pendentes.

## 15. Testes obrigatorios

### API

- selecionar campanha publicada correta;
- nao entregar campanha draft/paused/closed/fora do periodo;
- substituir placement atomicamente;
- emitir evento somente apos commit;
- resolver dispositivo anonimo e conhecido;
- nao duplicar perfil/participacao por retries;
- impedir participacao dupla;
- rejeitar token invalido/revogado;
- testar todas as permissoes por endpoint;
- sorteio somente com snapshot congelado;
- novo sorteio exige motivo e permissao.

### Institucional

- nova campanha aparece sem rebuild;
- evento SSE invalida a query correta;
- polling assume quando SSE falha;
- campanha nova ignora `completed` da antiga;
- dispositivo conhecido recebe modal curto;
- ja participante nao recebe modal repetido;
- limpar `localStorage` resulta em dispositivo novo, sem quebrar fluxo;
- mobile e desktop geram tokens independentes;
- nenhum dado pessoal e salvo no storage ou analytics.

### Painel

- publicar campanha atualiza placement;
- feedback mostra versao publica;
- recepcionista consegue cadastrar e contatar, mas nao exportar/sortear;
- locutor nao acessa telefone/exportacao por padrao;
- admin visualiza permissoes efetivas;
- telas funcionam em 320, 360, 390, 430, 768 e 1280px.

## 16. Criterios de aceite

- [ ] O institucional nao depende mais de slug de campanha no build.
- [ ] A campanha publicada no placement aparece imediatamente via SSE ou em ate 30 segundos no fallback.
- [ ] Trocar de aba e voltar força validacao da campanha atual.
- [ ] Uma campanha encerrada nunca bloqueia a descoberta de uma campanha nova.
- [ ] Cada instalacao possui token opaco proprio e o banco guarda apenas hash.
- [ ] Mobile web, desktop e Expo usam o mesmo contrato, com plataformas distintas.
- [ ] Ouvinte conhecido confirma participacao sem preencher PII novamente.
- [ ] Ouvinte ja participante nao recebe modal repetido.
- [ ] Campanhas anteriores nao bloqueiam o modal de campanhas novas.
- [ ] PII nao aparece em analytics, SSE, URLs ou storage local.
- [ ] Recepcionista, locutor, gestor e admin possuem permissoes efetivas distintas.
- [ ] Sorteios sao executados no backend e possuem auditoria.
- [ ] Migrações, testes, documentacao e plano de rollback estao atualizados.

## 17. Riscos e mitigacoes

| Risco | Impacto | Mitigacao |
| --- | --- | --- |
| Multiplas campanhas ativas | Modal errado | Placement com ponteiro unico e publicacao transacional |
| SSE bloqueado por proxy | Atualizacao atrasada | Polling, foco, reconnect e ETag |
| Usuario limpa storage | Perde reconhecimento | Fluxo anonimo seguro; OTP futuro |
| Mesmo ouvinte em dois aparelhos | Perfis duplicados | Vinculacao verificada/merge auditado; sem fingerprint |
| Telefone opcional | Dedupe limitada | Nao fazer merge automatico por dados fracos |
| Token copiado | Reconhecimento indevido | Token nao e autenticacao; rotacao/revogacao; sem retorno de PII |
| RBAC apenas visual | Vazamento de dados | Permissoes obrigatorias no backend |
| Sorteio questionado | Risco reputacional | Snapshot, CSPRNG, hash, auditoria e ata |
| Excesso de conexoes SSE | Instabilidade | Limites, heartbeat, metricas e fallback polling |

## 18. Rollout recomendado

1. backup do PostgreSQL;
2. publicar Fase 0 com endpoint dinamico e polling;
3. validar nova campanha em homologacao e producao;
4. adicionar placement/SSE sem remover endpoint legado;
5. adicionar identidade por dispositivo com feature flag;
6. migrar cadastros gradualmente;
7. ativar modal curto para percentual controlado de usuarios;
8. liberar RBAC e sorteios apos testes de autorizacao/auditoria;
9. remover configuracao de slug somente depois da janela de compatibilidade.

## 19. Workaround operacional ate a Fase 0

Para teste local imediato, alterar temporariamente:

```env
VITE_LISTENER_REGISTRATION_CAMPAIGN_SLUG=sorteios-radio-88
```

e reiniciar/rebuildar o institucional.

Esse procedimento apenas aponta o site para a campanha nova. Nao e a solucao definitiva e nao oferece atualizacao em tempo real.
