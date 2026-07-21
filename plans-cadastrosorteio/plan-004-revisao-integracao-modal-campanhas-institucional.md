# Plan 004 — Revisao da Integracao do Modal de Campanhas no Institucional

Status: Planejado  
Projeto: GestaoOuvintes + radio-88-fm-institucional  
Tipo: WEB/API  
Stack: Node.js, Fastify, PostgreSQL, React, TypeScript, Vite, TanStack Query, shadcn/ui

## 1. Agentes Recomendados

Com base em `docs/README.md` e `agents/README.md`, esta tarefa deve ser conduzida pelos seguintes agentes:

- Product Manager: validar a regra de negocio do modal, campanhas e comportamento de nova visita.
- Tech Lead / Arquiteto: revisar o fluxo ponta a ponta entre API, painel e site institucional.
- Backend API Engineer: revisar endpoints publicos, publicacao de campanha, device token, participacao e CORS.
- Institutional Frontend Engineer: revisar modal, hook, EventSource, polling, localStorage e UX no site institucional.
- QA Engineer: definir fluxo de testes reproduzivel para desktop, mobile, rede local e nova campanha.
- DevOps / Release Engineer: validar variaveis de ambiente, portas, CORS, rede local e deploy.
- Security Engineer: revisar privacidade do token de dispositivo, hash, IP e exposicao de dados.

## 2. Objetivo

Revisar e corrigir a integracao entre:

- `GestaoOuvintes/api-ouvintes`
- `GestaoOuvintes/painel-adm`
- `radio-88-fm-institucional`

O resultado esperado e que, ao criar/publicar uma nova campanha no Sistema de Gestao de Ouvintes, o site institucional mostre automaticamente o modal para visitantes elegiveis.

Regra desejada:

- Visitante sem cadastro deve ver o formulario do modal.
- Se o visitante fechar sem preencher, o modal deve voltar na proxima visita.
- Se o visitante se cadastrar em uma campanha, o modal nao deve aparecer novamente para aquela campanha naquele navegador/dispositivo.
- Se uma nova campanha/sorteio for publicada, o mesmo visitante deve ver o modal novamente.
- Se o visitante ja tiver cadastro vinculado ao dispositivo, o modal deve perguntar: "Voce ja tem cadastro, deseja participar deste sorteio?"

## 3. Estado Atual Encontrado

### 3.1 Captura do ouvinte nao e por IP

O fluxo atual nao identifica o usuario por IP para decidir se mostra o modal.

O site institucional cria um token local por navegador/dispositivo em:

```txt
radio-88-fm-institucional/src/services/listener-registration/storage.ts
```

Chaves usadas:

```txt
radio88.listener-registration.v2.device-token
radio88.listener-registration.v1.completed.{slug}
radio88.listener-registration.v1.dismissed.{slug}
radio88.listener-registration.v1.submission-token.{slug}
```

Esse token e enviado para a API no header:

```txt
X-Device-Token
```

Na API, o token e transformado em hash HMAC e salvo em:

```txt
listener_device.token_hash
```

O IP aparece apenas como auditoria/hash no registro legado `listener_registration.ip_hash`; ele nao deve controlar exibicao do modal.

### 3.2 Origem e navegador afetam o teste

`localStorage` e separado por origem. Portanto:

- `http://localhost:8080`
- `http://127.0.0.1:8080`
- `http://192.168.70.87:8080`

sao origens diferentes e geram tokens diferentes.

Isto e bom para teste, porque permite simular dispositivos diferentes. Nao e teste por IP; e teste por origem/navegador.

### 3.3 Campanha ativa nao basta

O modal do institucional nao consulta "qualquer campanha ativa". Ele consulta uma campanha publicada no placement:

```txt
institutional_modal
```

Fluxo atual:

```txt
painel-adm -> POST /api/admin/campaigns/:id/publish
api-ouvintes -> campaign_placement.placement_key = institutional_modal
radio-88-fm-institucional -> POST /api/public/session/resolve
```

Logo, se uma campanha foi criada como `active`, mas nao foi publicada no placement `institutional_modal`, o modal nao abre. revisar o botão publicar no painel adm 

### 3.4 Atualizacao em tempo quase real ja existe, mas precisa QA

O institucional usa duas estrategias:

- SSE em `GET /api/public/events?placement=institutional_modal`
- polling/refetch a cada 30 segundos

Quando a API publica uma campanha, ela emite:

```txt
campaign.changed
```

Isso deve forcar o refetch da sessao publica no site aberto. Se nao funcionar, o fallback deve atualizar em ate 30 segundos.

### 3.5 Regra de fechar modal esta diferente do requisito

Hoje, ao fechar o modal sem cadastrar, o front chama `dismiss()` e grava:

- `campaign_device_state.dismissed_until` na API
- `radio88.listener-registration.v1.dismissed.{slug}` no localStorage

O calculo usa `VITE_LISTENER_REGISTRATION_DISMISS_DAYS`, com minimo de 1 dia.

Isso conflita com o requisito atual:

> Se o ouvinte nao preencher, proxima visita dele deve aparecer novamente.

Portanto, precisa ajuste de regra: fechar sem cadastro deve ocultar apenas a sessao atual, nao gravar dispensa persistente por dias.

## 4. Causas Provaveis Para o Modal Nao Aparecer

Validar nesta ordem:

1. A campanha esta ativa, mas nao foi publicada no placement `institutional_modal`.
2. O institucional acessado por `192.168.70.87:8080` ainda chama API em `http://localhost:3010`.
3. `CORS_ALLOWED_ORIGINS` da API nao inclui `http://192.168.70.87:8080`.
4. A API nao esta acessivel pela rede local porque nao esta bindada em `0.0.0.0`.
5. O dispositivo/navegador ja possui participacao em `campaign_participation` para a campanha atual.
6. O dispositivo/navegador possui `dismissedUntil` valido no banco ou localStorage.
7. A campanha esta fora do periodo (`starts_at` futuro ou `ends_at` passado).
8. A migration `0002_campaign_platform_identity_rbac.sql` nao foi aplicada.
9. O EventSource falha por CORS ou URL incorreta.
10. `VITE_LISTENER_REGISTRATION_ENABLED` esta diferente de `true`.

## 5. Decisoes de Arquitetura

### 5.1 Identidade do visitante

Manter identificacao por device token de navegador/dispositivo, nao por IP.

Motivos:

- IP compartilhado em redes domesticas, empresas e operadoras moveis.
- IP muda com frequencia em 4G/5G.
- IP e ruim para teste local e ruim para privacidade.
- Token local permite distinguir desktop/mobile e preparar futura integracao com Expo/React Native.

### 5.2 Device token

Manter:

```txt
X-Device-Token
listener_device.token_hash
```

Regras:

- O token bruto nunca deve ser salvo no banco.
- O hash deve continuar sendo HMAC com `DEVICE_TOKEN_SECRET`.
- No Expo futuramente, o app deve gerar token proprio por instalacao e enviar no mesmo header.

### 5.3 Publicacao automatica de campanha

Como o requisito diz que "ao criar uma campanha no Sistema de Gestao de Ouvintes automaticamente aparece", existem duas alternativas.

Recomendacao:

- No painel, ao criar ou editar campanha ativa, adicionar um controle "Publicar no modal do institucional".
- Para o fluxo de lancamento, deixar esse controle marcado por padrao.
- Ao salvar uma campanha `active` com esse controle marcado, o painel chama automaticamente `POST /api/admin/campaigns/:id/publish`.

Isso evita que "campanha ativa" e "campanha publicada" fiquem fora de sincronia sem esconder a decisao editorial.

### 5.4 Fechamento do modal

Alterar o comportamento:

- Clicar em fechar ou "Agora nao" deve esconder apenas durante a sessao atual da aba.
- Nao deve gravar `dismissedUntil` persistente por dias.
- Em nova visita/reload, se ainda nao participou, o modal deve reaparecer.

Implementacao sugerida:

- Front: trocar o estado persistente de dismissed por `sessionStorage` ou apenas state em memoria.
- API: manter `campaign_device_state.dismissed_until` para uso futuro, mas nao usar no fluxo do modal institucional atual.
- Variavel `VITE_LISTENER_REGISTRATION_DISMISS_DAYS` deve deixar de controlar esse fluxo ou aceitar `0` como "nao persistir dispensa".

## 6. Plano de Implementacao

### Fase 1 — Diagnostico sem alterar regra

1. Confirmar variaveis do institucional:

```txt
radio-88-fm-institucional/.env.local
VITE_LISTENER_REGISTRATION_ENABLED=true
VITE_LISTENER_REGISTRATION_API_URL=http://localhost:3010
VITE_LISTENER_REGISTRATION_PLACEMENT=institutional_modal
```

2. Para teste via rede `192.168.70.87:8080`, ajustar temporariamente:

```txt
VITE_LISTENER_REGISTRATION_API_URL=http://192.168.70.87:3010
```

3. Confirmar CORS da API:

```txt
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://192.168.70.87:8080,http://localhost:5174,http://127.0.0.1:5174,http://192.168.70.87:5174
```

4. Confirmar que API sobe em rede:

```txt
HOST=0.0.0.0
PORT=3010
```

5. Confirmar saude:

```bash
curl http://localhost:3010/api/health
curl http://192.168.70.87:3010/api/health
```

6. Confirmar placement publicado no banco:

```sql
SELECT
  cp.placement_key,
  cp.campaign_id,
  cp.version,
  cp.published_at,
  c.slug,
  c.status,
  c.starts_at,
  c.ends_at
FROM campaign_placement cp
LEFT JOIN campaign c ON c.id = cp.campaign_id
WHERE cp.placement_key = 'institutional_modal';
```

7. Confirmar campanhas ativas elegiveis:

```sql
SELECT id, slug, status, starts_at, ends_at, archived_at
FROM campaign
ORDER BY created_at DESC;
```

8. Testar sessao publica com token novo:

```bash
curl -X POST http://localhost:3010/api/public/session/resolve \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: 1111111111111111111111111111111111111111111111111111111111111111" \
  -H "X-Platform: web_desktop" \
  -d '{"placement":"institutional_modal","platform":"web_desktop"}'
```

Resultado esperado para visitante novo:

```json
{
  "campaign": { "active": true },
  "listenerState": "anonymous",
  "experience": "anonymous_registration_required"
}
```

9. Testar SSE:

```bash
curl -N "http://localhost:3010/api/public/events?placement=institutional_modal"
```

Resultado esperado:

```txt
event: heartbeat
event: campaign.changed
```

### Fase 2 — Ajustar publicacao automatica no painel

1. Em `CampaignFormDialog`, adicionar opcao:

```txt
Publicar no modal do institucional
```

2. Default:

- `true` para nova campanha ativa.
- Preservar valor escolhido em edicao.

3. Em `CampaignsPage`, apos criar/editar campanha ativa com publish habilitado:

- chamar `api.publishCampaign(campaign.id, "institutional_modal")`;
- invalidar queries de campanhas;
- exibir toast claro: "Campanha salva e publicada no institucional."

4. Exibir no card da campanha um status de publicacao:

- "Publicada no institucional"
- "Nao publicada no institucional"

5. Adicionar query de placements no painel usando `GET /api/admin/campaigns/placements/list`.

### Fase 3 — Ajustar regra de fechamento do modal

1. Em `useListenerRegistrationCampaign`, separar:

- `closeForCurrentSession()`
- `complete()`

2. Ao fechar sem cadastrar:

- nao chamar `dismissCampaignForDevice`;
- nao gravar `dismissed` em `localStorage`;
- apenas fechar na sessao atual.

3. Para evitar reabrir imediatamente na mesma pagina:

- usar `sessionStorage` com chave:

```txt
radio88.listener-registration.session-dismissed.{campaignSlug}
```

4. Em nova visita/reload, limpar o bloqueio se a regra final for "sempre reaparecer".

Alternativa mais controlada:

- bloquear apenas durante a vida da aba atual;
- ao abrir nova aba ou novo acesso, modal reaparece.

5. Manter `markListenerRegistrationCompleted(slug)` somente apos cadastro/participacao bem-sucedidos.

### Fase 4 — Melhorar observabilidade do fluxo

1. No modo development, adicionar logs controlados por env:

```txt
VITE_LISTENER_REGISTRATION_DEBUG=true
```

Logs sugeridos:

- API URL usada.
- Placement usado.
- Device token prefixado/mascarado.
- `experience` retornada.
- Motivo de nao abrir modal.

2. Na API, manter logs redigidos sem dados sensiveis:

- placement resolvido;
- campaign id publicada;
- status `experience`;
- erros CORS.

3. No painel, mostrar "Ultima publicacao" e "placement version".

### Fase 5 — Testes automatizados

#### API

Adicionar/ajustar testes:

- `session/resolve` retorna `anonymous_registration_required` para token novo e campanha publicada.
- `session/resolve` retorna `known_listener_confirmation_required` para device vinculado a profile sem participacao na nova campanha.
- `session/resolve` retorna `already_participating` apos participacao.
- publicar campanha em `institutional_modal` atualiza `campaign_placement.version`.
- publicar campanha emite `campaign.changed`.
- campanha ativa sem placement retorna `campaign_unavailable`.

#### Institucional

Adicionar/ajustar testes com mock de API:

- modal abre quando `experience = anonymous_registration_required`.
- modal nao abre quando `experience = already_participating`.
- fechar sem cadastrar nao marca completed.
- fechar sem cadastrar permite reaparecer em nova visita.
- cadastro com sucesso chama `markListenerRegistrationCompleted`.
- EventSource `campaign.changed` dispara refetch.

#### Painel

Adicionar/ajustar testes:

- criar campanha ativa com "Publicar no institucional" chama `createCampaign` e `publishCampaign`.
- card exibe status de publicacao no placement.
- botao Publicar continua funcionando manualmente.

## 7. Fluxo de Teste Local Recomendado

### 7.1 Subir API

```bash
cd GestaoOuvintes/api-ouvintes
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

API esperada:

```txt
http://localhost:3010
http://192.168.70.87:3010
```

### 7.2 Subir painel

```bash
cd GestaoOuvintes/painel-adm
npm run dev -- --host 0.0.0.0
```

Painel esperado:

```txt
http://localhost:5174
http://192.168.70.87:5174
```

### 7.3 Subir institucional

```bash
cd radio-88-fm-institucional
npm run dev -- --host 0.0.0.0
```

Institucional esperado:

```txt
http://localhost:8080
http://192.168.70.87:8080
```

### 7.4 Testar visitante novo

1. Abrir aba anonima em:

```txt
http://localhost:8080
```

2. Confirmar no DevTools > Network:

```txt
POST /api/public/session/resolve -> 200
GET /api/public/events?placement=institutional_modal -> event-stream
```

3. Confirmar modal aberto.

4. Fechar sem cadastrar.

5. Recarregar ou abrir nova visita.

Resultado esperado apos ajuste:

```txt
Modal aparece novamente.
```

### 7.5 Testar cadastro

1. Abrir modal.
2. Preencher:

```txt
Nome: Teste Ouvinte
Bairro: Retiro
Cidade: Volta Redonda
Telefone: opcional
```

3. Enviar cadastro.
4. Confirmar no painel que o cadastro apareceu.
5. Recarregar o institucional na mesma origem/navegador.

Resultado esperado:

```txt
Modal nao aparece mais para a mesma campanha.
```

### 7.6 Testar nova campanha

1. Criar nova campanha ativa no painel.
2. Publicar no modal do institucional.
3. Manter o institucional aberto.
4. Aguardar evento SSE ou ate 30 segundos.

Resultado esperado:

```txt
Modal abre para a nova campanha.
```

Se o dispositivo ja tiver cadastro:

```txt
Modal curto pergunta se deseja participar do novo sorteio.
```

### 7.7 Testar por IP de rede

Para acessar de outro dispositivo usando:

```txt
http://192.168.70.87:8080
```

garantir:

```txt
VITE_LISTENER_REGISTRATION_API_URL=http://192.168.70.87:3010
CORS_ALLOWED_ORIGINS inclui http://192.168.70.87:8080
API HOST=0.0.0.0
```

Caso contrario, o navegador tentara chamar `localhost:3010` no proprio dispositivo cliente e o modal nao carregara.

### 7.8 Reset manual para QA

No DevTools do institucional:

```js
localStorage.removeItem("radio88.listener-registration.v2.device-token")
Object.keys(localStorage)
  .filter((key) => key.startsWith("radio88.listener-registration."))
  .forEach((key) => localStorage.removeItem(key))
sessionStorage.clear()
```

No banco, para limpar estado de teste de um token/campanha especifica, preferir criar novo token/origem em vez de apagar dados reais.

## 8. Checklist de Aceite

- [ ] Documento confirma que a captura do ouvinte e por token de navegador/dispositivo, nao IP.
- [ ] API responde `session/resolve` com campanha publicada em `institutional_modal`.
- [ ] Painel deixa claro qual campanha esta publicada no modal do institucional.
- [ ] Criar campanha ativa com publicacao habilitada faz a campanha aparecer no institucional sem acao manual extra.
- [ ] Site aberto recebe atualizacao via SSE ou fallback de 30 segundos.
- [ ] Fechar modal sem cadastrar nao bloqueia a proxima visita.
- [ ] Cadastrar/participar bloqueia o modal somente para aquela campanha no mesmo dispositivo/navegador.
- [ ] Nova campanha publicada reabre o modal para visitantes cadastrados e nao cadastrados.
- [ ] Acesso por `192.168.70.87:8080` funciona com API em `192.168.70.87:3010`.
- [ ] Testes automatizados cobrem API, painel e institucional.

## 9. Arquivos Provavelmente Afetados na Implementacao

```txt
GestaoOuvintes/api-ouvintes/src/services/campaign-service.ts
GestaoOuvintes/api-ouvintes/src/routes/admin-campaigns.ts
GestaoOuvintes/api-ouvintes/src/routes/public.ts
GestaoOuvintes/api-ouvintes/tests/integration/api.test.ts

GestaoOuvintes/painel-adm/src/pages/CampaignsPage.tsx
GestaoOuvintes/painel-adm/src/components/campaigns/CampaignFormDialog.tsx
GestaoOuvintes/painel-adm/src/services/api.ts
GestaoOuvintes/painel-adm/src/types/api.ts

radio-88-fm-institucional/src/hooks/useListenerRegistrationCampaign.ts
radio-88-fm-institucional/src/components/listener-registration/ListenerRegistrationModal.tsx
radio-88-fm-institucional/src/services/listener-registration/api.ts
radio-88-fm-institucional/src/services/listener-registration/storage.ts
```

## 10. Fora de Escopo

- Sorteio automatico de vencedores.
- RBAC completo por recepcionista/locutor alem do que ja esta desenhado no PRD 003.
- Integracao com React Native/Expo neste momento.
- Envio de WhatsApp automatico.
- Importacao em massa de ouvintes.

## 11. Riscos

- Teste por IP de rede falhara se o front usar `localhost` como API URL.
- CORS pode bloquear silenciosamente o modal se a origem `192.168.70.87:8080` nao estiver liberada.
- Publicar automaticamente toda campanha ativa pode substituir uma campanha anterior sem confirmacao editorial; por isso o painel deve mostrar claramente o placement atual.
- `localStorage` por navegador nao identifica a mesma pessoa em outro navegador/dispositivo. Isso e aceitavel agora e preparado para evoluir com app/conta no futuro.

## 12. Resultado Esperado Apos Implementacao

O fluxo final deve ser:

1. Administrador cria campanha ativa no painel.
2. Campanha e publicada no placement `institutional_modal`.
3. API emite `campaign.changed`.
4. Institucional refaz `session/resolve`.
5. Visitante novo ve formulario.
6. Visitante conhecido sem participacao ve confirmacao de participacao.
7. Visitante que ja participou daquela campanha nao ve modal.
8. Visitante que fechou sem preencher volta a ver o modal na proxima visita.
