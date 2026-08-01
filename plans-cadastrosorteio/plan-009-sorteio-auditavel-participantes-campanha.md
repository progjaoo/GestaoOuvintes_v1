# Plano 009 - Sorteio auditavel de participantes por campanha

## Status

Implementado e validado no PostgreSQL local em Docker. Publicacao no Neon e em producao permanece pendente de aprovacao.

## 1. Objetivo

Adicionar ao Sistema de Gestao de Ouvintes um fluxo seguro para sortear um participante de uma campanha do tipo `sweepstake`.

Na tela de Campanhas, o usuario autorizado tera um botao **Sortear**. Ao aciona-lo, o painel abrira um modal que apresentara uma animacao com nomes dos participantes e, ao final, exibira:

- nome do vencedor;
- cidade;
- bairro;
- telefone;
- botoes **Sortear novamente** e **Fechar**.

O sorteio real sera executado e persistido pela API. O navegador apenas exibira a animacao e o resultado retornado pelo backend.

## 2. Referencias e agentes

### 2.1 Documentacao consultada

- `GestaoOuvintes/docs/README.md`
- `GestaoOuvintes/docs/architecture.md`
- `GestaoOuvintes/docs/backend-api.md`
- `GestaoOuvintes/docs/database.md`
- `GestaoOuvintes/docs/frontend-admin.md`
- `GestaoOuvintes/docs/security-privacy.md`
- `agents/README.md`
- `GestaoOuvintes/plans-cadastrosorteio/prd-003-plataforma-sorteios-campanhas-identidade-e-rbac.md`

### 2.2 Agente principal

**Tech Lead / Arquiteto de Software**: responsavel por garantir que banco, API, RBAC, painel e auditoria formem um unico fluxo coerente.

### 2.3 Agentes de apoio

- **Backend API Engineer**: endpoint transacional e regras do sorteio.
- **Database Engineer**: migracao aditiva, indices, snapshot e concorrencia.
- **UI/UX Designer**: modal, animacao, estados e acessibilidade.
- **Security Engineer**: autorizacao, exposicao de PII e trilha de auditoria.
- **QA Engineer**: testes funcionais, concorrencia, erros e regressao.
- **DevOps / Release Engineer**: migracao no Neon e ordem segura de deploy.
- **Documentation Engineer**: atualizacao da documentacao operacional e tecnica.

## 3. Diagnostico da base atual

A base ja possui os elementos fundamentais:

- `campaign.type = 'sweepstake'` para identificar campanhas de sorteio;
- `campaign_participation` para vincular um ouvinte a uma campanha;
- status de participacao `eligible`, `entered`, `withdrawn` e `disqualified`;
- `listener_profile` com nome, cidade, bairro e telefone;
- RBAC com papeis e permissoes;
- `admin_audit_log` para auditoria administrativa;
- tela `CampaignsPage.tsx`, onde o novo botao pode ser associado a cada campanha.

Nao existe ainda uma estrutura persistente para registrar sorteios, snapshots dos concorrentes, vencedor, algoritmo e ressorteios. Essa estrutura nao deve ser simulada no frontend.

## 4. Decisoes de negocio recomendadas

### 4.1 Universo de participantes

Participam somente os registros de `campaign_participation` da campanha selecionada que atendam a todos os criterios:

- `campaign_participation.status IN ('eligible', 'entered')`;
- `listener_profile.status = 'active'`;
- `listener_profile.deleted_at IS NULL`;
- nao tenham sido sorteados anteriormente na mesma campanha, quando a operacao for um ressorteio.

Nao usar a lista global de ouvintes e nao misturar participantes de campanhas diferentes.

### 4.2 Campanha encerrada antes da apuracao

O sorteio inicial so pode ocorrer quando:

- `campaign.type = 'sweepstake'`;
- `campaign.status = 'closed'`;
- existir ao menos um participante elegivel.

Essa regra evita alteracao do conjunto de participantes durante a apuracao. Se a equipe quiser sortear enquanto a campanha ainda estiver ativa, isso devera ser uma decisao de produto posterior, com uma acao explicita de congelamento das inscricoes.

### 4.3 Cadastros anteriores a `campaign_participation`

Antes da liberacao, executar uma conferencia entre:

- total de `listener_registration` valido por campanha;
- total de `campaign_participation` elegivel por campanha.

Criar um script idempotente de backfill para transformar registros legados em perfis e participacoes quando necessario. O sorteio devera ser bloqueado se houver cadastros validos ainda nao vinculados, evitando excluir ouvintes silenciosamente.

### 4.4 Ressorteio

**Sortear novamente** devera:

- criar um novo registro de sorteio, sem editar ou apagar o anterior;
- marcar o resultado anterior como substituido;
- usar o mesmo conjunto congelado do sorteio inicial;
- excluir todos os vencedores anteriores daquela campanha;
- registrar o motivo tecnico `manual_redraw_from_result_modal`;
- retornar `409 NO_REMAINING_ELIGIBLE_PARTICIPANTS` se nao restar outro participante.

## 5. Arquitetura do fluxo

```text
CampaignsPage
    |
    | usuario autorizado clica em Sortear
    v
SweepstakeDrawDialog
    |
    | POST autenticado + Idempotency-Key
    v
admin-sweepstakes route
    |
    | requireAuthentication + sweepstake.draw
    v
sweepstake-service (transacao PostgreSQL)
    |
    | lock da campanha -> valida -> congela elegiveis
    | -> crypto.randomInt -> persiste vencedor/auditoria
    v
Resposta protegida com amostra de nomes + vencedor
    |
    | animacao visual local
    v
Nome + cidade + bairro + telefone
```

## 6. Banco de dados

### 6.1 Migracao aditiva

Criar:

```text
GestaoOuvintes/api-ouvintes/database/migrations/0006_sweepstake_draws.sql
```

Nao editar migracoes publicadas.

### 6.2 Tabela `sweepstake_draw`

Campos recomendados:

```sql
id uuid primary key default gen_random_uuid()
campaign_id uuid not null references campaign(id) on delete restrict
sequence integer not null
status varchar(20) not null -- selected | superseded | cancelled
winner_participation_id uuid not null references campaign_participation(id)
root_draw_id uuid null references sweepstake_draw(id)
previous_draw_id uuid null references sweepstake_draw(id)
executed_by_admin_user_id uuid not null references admin_user(id)
algorithm varchar(80) not null
eligible_count integer not null
entries_hash varchar(64) not null
reason_code varchar(80) null
request_token uuid not null unique
created_at timestamptz not null default now()
superseded_at timestamptz null
```

Regras e indices:

- `UNIQUE (campaign_id, sequence)`;
- indice por `campaign_id, created_at DESC`;
- indice por `winner_participation_id`;
- constraint de status;
- indice unico parcial para existir somente um resultado `selected` por campanha;
- `eligible_count > 0`;
- `sequence > 0`.

### 6.3 Tabela `sweepstake_draw_entry`

Snapshot imutavel dos concorrentes considerados em cada apuracao:

```sql
draw_id uuid not null references sweepstake_draw(id) on delete restrict
participation_id uuid not null references campaign_participation(id) on delete restrict
ordinal integer not null
primary key (draw_id, participation_id)
unique (draw_id, ordinal)
```

O snapshot guarda apenas referencias, nao duplica nome ou telefone.

### 6.4 Permissoes

Adicionar:

- `sweepstake.read`;
- `sweepstake.draw`;
- `sweepstake.redraw`.

Conceder inicialmente apenas ao papel `admin`. O papel `campaign_manager` podera receber `sweepstake.read` em uma etapa posterior, mas nao deve sortear sem aprovacao explicita.

### 6.5 Drizzle

Atualizar `src/database/schema.ts` com:

- `sweepstakeDraws`;
- `sweepstakeDrawEntries`;
- tipos inferidos correspondentes.

## 7. Backend API

### 7.1 Novos arquivos

```text
GestaoOuvintes/api-ouvintes/src/schemas/sweepstake.ts
GestaoOuvintes/api-ouvintes/src/services/sweepstake-service.ts
GestaoOuvintes/api-ouvintes/src/routes/admin-sweepstakes.ts
GestaoOuvintes/api-ouvintes/scripts/backfill-campaign-participations.ts
```

Registrar as rotas em `src/app.ts` com prefixo:

```text
/api/admin/sweepstakes
```

### 7.2 Endpoints

#### Conferencia antes do sorteio

```http
GET /api/admin/sweepstakes/:campaignId/status
```

Resposta:

```json
{
  "campaignId": "uuid",
  "campaignName": "Sorteio 32 anos",
  "campaignStatus": "closed",
  "eligibleCount": 248,
  "legacyUnlinkedCount": 0,
  "canDraw": true,
  "currentDraw": null
}
```

Se ja houver resultado, `currentDraw` retorna os dados necessarios para recuperar o modal sem criar outro vencedor.

#### Sorteio inicial

```http
POST /api/admin/sweepstakes/:campaignId/draw
Idempotency-Key: <uuid>
```

#### Ressorteio

```http
POST /api/admin/sweepstakes/:campaignId/redraw
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "previousDrawId": "uuid"
}
```

### 7.3 Contrato de resposta

```ts
interface SweepstakeDrawResponse {
  drawId: string;
  campaignId: string;
  sequence: number;
  eligibleCount: number;
  drawnAt: string;
  animationNames: string[];
  winner: {
    participationId: string;
    name: string;
    city: string;
    neighborhood: string;
    phone: string | null;
  };
}
```

Todos os participantes concorrem. Para desempenho e minimizacao de PII, `animationNames` sera uma amostra embaralhada de no maximo 30 nomes, sempre terminando no nome do vencedor. A amostra e apenas visual e nao define o resultado.

### 7.4 Algoritmo

Usar exclusivamente a API criptografica publica do Node:

```ts
import { randomInt } from "node:crypto";

const winnerIndex = randomInt(eligibleParticipants.length);
```

Identificador inicial do algoritmo:

```text
node_crypto_random_int_v1
```

Nao usar `Math.random()` e nao executar a escolha no navegador.

### 7.5 Transacao e concorrencia

Dentro de uma unica transacao:

1. adquirir `pg_advisory_xact_lock` derivado do `campaignId`;
2. validar tipo e status da campanha;
3. validar o `Idempotency-Key`;
4. contar cadastros legados sem participacao e bloquear se houver divergencia;
5. consultar participantes elegiveis com ordenacao estavel por UUID;
6. excluir vencedores anteriores em caso de ressorteio;
7. calcular SHA-256 da lista ordenada de IDs (`entries_hash`);
8. escolher o indice com `crypto.randomInt`;
9. gravar `sweepstake_draw` e `sweepstake_draw_entry`;
10. superseder o resultado anterior, quando aplicavel;
11. inserir evento em `admin_audit_log` sem nome ou telefone;
12. efetivar a transacao.

### 7.6 Codigos de erro

- `CAMPAIGN_NOT_FOUND` - 404;
- `CAMPAIGN_NOT_SWEEPSTAKE` - 409;
- `CAMPAIGN_NOT_CLOSED` - 409;
- `NO_ELIGIBLE_PARTICIPANTS` - 409;
- `LEGACY_PARTICIPATIONS_PENDING` - 409;
- `DRAW_ALREADY_EXISTS` - 409;
- `NO_REMAINING_ELIGIBLE_PARTICIPANTS` - 409;
- `DRAW_CONFLICT` - 409;
- `INSUFFICIENT_PERMISSION` - 403.

## 8. Painel administrativo

### 8.1 Local do botao

Em `src/pages/CampaignsPage.tsx`, adicionar o botao **Sortear** na area de acoes do card da campanha.

Regras:

- exibir somente para campanhas `type === 'sweepstake'`;
- exibir somente para usuario com `sweepstake.draw`;
- habilitar somente quando `status === 'closed'`;
- usar icone `Trophy` ou `Dices` do `lucide-react`;
- manter **Editar** e **Publicar** sem regressao.

Se o frontend ainda nao receber permissoes efetivas no `/auth/me`, ampliar `AdminUser` com `permissions: string[]` e atualizar login, `me`, contexto de autenticacao e testes.

### 8.2 Novo modal

Criar:

```text
GestaoOuvintes/painel-adm/src/components/campaigns/SweepstakeDrawDialog.tsx
```

Usar o `Dialog` Radix ja existente no projeto.

Estados do modal:

1. `checking`: consulta elegibilidade e eventual resultado atual;
2. `drawing`: requisicao criada e controles bloqueados;
3. `animating`: alternancia progressiva dos nomes;
4. `winner`: vencedor revelado;
5. `redrawing`: novo sorteio solicitado;
6. `error`: mensagem objetiva e opcao segura de tentar novamente.

### 8.3 Animacao

- duracao recomendada: 4 segundos;
- comecar mais rapida e desacelerar antes do vencedor;
- alterar somente `transform` e `opacity` para preservar desempenho;
- nao usar a animacao para decidir o vencedor;
- em `prefers-reduced-motion: reduce`, pular a rolagem de nomes e mostrar o resultado diretamente;
- anunciar o vencedor em uma regiao `aria-live="polite"`;
- bloquear fechamento por `Escape`, overlay e botao X enquanto a requisicao ou animacao estiver em andamento;
- limpar os dados sensiveis do estado ao fechar.

### 8.4 Resultado

Exibir de forma legivel:

```text
Nome: Maria da Silva
Cidade: Volta Redonda
Bairro: Retiro
Telefone: (24) 99999-9999
```

Telefone nulo deve aparecer como `Nao informado`, sem quebrar o modal.

Rodape final com exatamente:

- **Sortear novamente**;
- **Fechar**.

O botao de ressorteio deve exigir uma confirmacao curta informando que o resultado anterior sera preservado na auditoria e nao participara novamente.

### 8.5 Cliente da API

Atualizar:

```text
GestaoOuvintes/painel-adm/src/types/api.ts
GestaoOuvintes/painel-adm/src/services/api.ts
```

Adicionar tipos e metodos:

- `getSweepstakeStatus(campaignId)`;
- `drawSweepstake(campaignId, requestToken)`;
- `redrawSweepstake(campaignId, previousDrawId, requestToken)`.

Usar `crypto.randomUUID()` no cliente apenas como chave de idempotencia, nunca como fonte do sorteio.

## 9. Seguranca e privacidade

- autenticacao obrigatoria em todos os endpoints;
- autorizacao no backend com `requirePermission`, independentemente da visibilidade do botao;
- rate limit especifico e baixo para sorteio e ressorteio;
- nao registrar nome, telefone, cidade ou bairro em logs de aplicacao;
- nao enviar dados do sorteio para GA4, Vercel Analytics ou ferramentas de telemetria;
- resposta com `Cache-Control: no-store`;
- telefone retornado apenas ao papel que tambem possua `listener.phone.read`;
- idempotencia para impedir dois resultados por clique duplicado/retry;
- lock transacional para impedir dois administradores de sortearem simultaneamente;
- manter registros de sorteio imutaveis;
- nao expor a lista completa de telefones ou participantes no payload da animacao.

## 10. Testes

### 10.1 Backend unitario

Criar `tests/unit/sweepstake-service.test.ts` cobrindo:

- selecao dentro dos limites da lista;
- RNG injetavel nos testes para resultado deterministico;
- hash estavel para a mesma lista ordenada;
- exclusao de participantes retirados, desclassificados, bloqueados ou excluidos;
- exclusao de vencedores anteriores no ressorteio;
- amostra visual limitada e com vencedor no final.

### 10.2 Backend integracao

Criar `tests/integration/sweepstake-api.test.ts` cobrindo:

- 401 sem autenticacao;
- 403 sem permissao;
- 409 para campanha que nao e sorteio;
- 409 para campanha ainda aberta;
- 409 sem participantes;
- 409 quando existem registros legados nao vinculados;
- sorteio persistido com snapshot e auditoria;
- repeticao do mesmo `Idempotency-Key` devolve o mesmo resultado;
- chamadas concorrentes nao criam dois resultados ativos;
- ressorteio preserva o primeiro resultado e escolhe outro participante;
- erro quando nao existe outro participante disponivel;
- payload protegido por `Cache-Control: no-store`.

### 10.3 Frontend

Criar `SweepstakeDrawDialog.test.tsx` cobrindo:

- estados de carregamento, animacao, resultado e erro;
- exibicao dos quatro dados do vencedor;
- botoes finais;
- ressorteio;
- `prefers-reduced-motion`;
- bloqueio de clique duplo;
- fechamento e limpeza de PII;
- ausencia do botao para campanha comum ou usuario sem permissao.

### 10.4 Validacao manual

1. Criar campanha `sweepstake` de teste.
2. Cadastrar pelo menos cinco ouvintes diferentes nessa campanha.
3. Confirmar o total elegivel.
4. Encerrar a campanha.
5. Clicar em **Sortear**.
6. Verificar a animacao e o vencedor.
7. Atualizar a pagina e confirmar recuperacao do resultado.
8. Executar **Sortear novamente** e confirmar vencedor diferente.
9. Conferir registros no banco e `admin_audit_log`.
10. Testar teclado, mobile e movimento reduzido.

## 11. Ordem de implementacao

### Fase 1 - Banco e consistencia

1. Criar a migracao `0006_sweepstake_draws.sql`.
2. Atualizar o schema Drizzle.
3. Criar o backfill idempotente e modo `--dry-run`.
4. Criar relatorio de divergencia por campanha.
5. Testar em PostgreSQL local antes do Neon.

### Fase 2 - API

1. Escrever testes das regras primeiro.
2. Criar schemas Zod de params, headers, body e respostas.
3. Implementar servico transacional.
4. Implementar endpoints e permissoes.
5. Registrar rotas em `app.ts`.
6. Validar concorrencia e idempotencia.

### Fase 3 - Painel

1. Atualizar contratos TypeScript e cliente HTTP.
2. Expor permissoes efetivas do usuario.
3. Criar `SweepstakeDrawDialog`.
4. Adicionar o botao em `CampaignsPage`.
5. Implementar estados, animacao, acessibilidade e responsividade.
6. Criar testes de componente.

### Fase 4 - Documentacao e release

1. Atualizar `docs/database.md`.
2. Atualizar `docs/backend-api.md`.
3. Atualizar `docs/frontend-admin.md`.
4. Atualizar `docs/security-privacy.md`.
5. Executar backfill em modo dry-run no Neon e revisar contagens.
6. Aplicar migracao no Neon.
7. Publicar API.
8. Fazer smoke test da API de producao.
9. Publicar painel.
10. Fazer sorteio de homologacao em campanha isolada.

## 12. Comandos de verificacao

```bash
cd GestaoOuvintes/api-ouvintes
npm run typecheck
npm test
npm run test:integration
npm run build

cd ../painel-adm
npm run lint
npm test
npm run build
```

## 13. Arquivos previstos

### Novos

```text
GestaoOuvintes/api-ouvintes/database/migrations/0006_sweepstake_draws.sql
GestaoOuvintes/api-ouvintes/src/schemas/sweepstake.ts
GestaoOuvintes/api-ouvintes/src/services/sweepstake-service.ts
GestaoOuvintes/api-ouvintes/src/routes/admin-sweepstakes.ts
GestaoOuvintes/api-ouvintes/scripts/backfill-campaign-participations.ts
GestaoOuvintes/api-ouvintes/tests/unit/sweepstake-service.test.ts
GestaoOuvintes/api-ouvintes/tests/integration/sweepstake-api.test.ts
GestaoOuvintes/painel-adm/src/components/campaigns/SweepstakeDrawDialog.tsx
GestaoOuvintes/painel-adm/src/components/campaigns/SweepstakeDrawDialog.test.tsx
```

### Alterados

```text
GestaoOuvintes/api-ouvintes/src/database/schema.ts
GestaoOuvintes/api-ouvintes/src/app.ts
GestaoOuvintes/painel-adm/src/pages/CampaignsPage.tsx
GestaoOuvintes/painel-adm/src/services/api.ts
GestaoOuvintes/painel-adm/src/types/api.ts
GestaoOuvintes/painel-adm/src/contexts/AuthContext.tsx
GestaoOuvintes/docs/database.md
GestaoOuvintes/docs/backend-api.md
GestaoOuvintes/docs/frontend-admin.md
GestaoOuvintes/docs/security-privacy.md
```

## 14. Criterios de aceite

- [ ] O botao **Sortear** aparece apenas em campanhas do tipo sorteio e para usuarios autorizados.
- [ ] O sorteio so utiliza participacoes elegiveis da campanha selecionada.
- [ ] Cadastros legados nao vinculados bloqueiam a operacao ate serem reconciliados.
- [ ] A campanha precisa estar encerrada antes do sorteio.
- [ ] O vencedor e escolhido na API com `node:crypto.randomInt`.
- [ ] O resultado e persistido com snapshot, hash, algoritmo, executor e data.
- [ ] Dois cliques ou requests concorrentes nao criam dois vencedores ativos.
- [ ] O modal anima nomes e revela nome, cidade, bairro e telefone.
- [ ] O resultado final possui **Sortear novamente** e **Fechar**.
- [ ] O ressorteio nao repete vencedores anteriores e preserva toda a auditoria.
- [ ] O modal e responsivo, acessivel e respeita movimento reduzido.
- [ ] PII nao aparece em logs, analytics ou payloads desnecessarios.
- [ ] Migracao, backfill, API e painel possuem testes automatizados.
- [ ] Typecheck, lint, testes e builds passam.

## 15. Riscos e mitigacoes

### Participantes legados ausentes

**Risco:** ouvintes cadastrados antes da estrutura de perfis nao participarem.

**Mitigacao:** relatorio de divergencia e backfill bloqueante antes do sorteio.

### Clique duplo ou concorrencia

**Risco:** dois vencedores ativos.

**Mitigacao:** `Idempotency-Key`, lock transacional e indice unico parcial.

### Ressorteio sem rastreabilidade

**Risco:** perda de confianca no processo.

**Mitigacao:** registros imutaveis, sequencia, resultado substituido e auditoria.

### Animacao confundida com algoritmo

**Risco:** parecer que o frontend escolheu o vencedor.

**Mitigacao:** resultado definido antes na API; animacao e exclusivamente visual.

### Exposicao de dados pessoais

**Risco:** enviar todos os dados dos participantes ao browser ou aos logs.

**Mitigacao:** amostra limitada somente com nomes, telefone apenas do vencedor e `no-store`.

## 16. Decisoes para validacao

Antes da implementacao, validar com a gestao:

1. O sorteio somente podera ocorrer quando a campanha estiver com status `closed`.
2. Um vencedor descartado por **Sortear novamente** nao concorrera novamente naquela campanha.
3. Todos os participantes elegiveis concorrem, mas o modal mostrara no maximo 30 nomes durante a animacao para manter desempenho e privacidade.
4. Inicialmente somente administradores poderao sortear e ressorteiar.


## 17. Implementacao realizada

- migracao aditiva `0006_sweepstake_draws.sql` com snapshot, auditoria, RBAC e restricoes de concorrencia;
- servico transacional com `crypto.randomInt`, idempotencia e ressorteio sem repeticao de vencedores;
- endpoints administrativos de status, sorteio e ressorteio;
- backfill idempotente com dry-run para participacoes legadas;
- modal responsivo no painel com animacao visual, movimento reduzido e recuperacao de resultado;
- botao **Sortear** condicionado ao tipo, status e permissao da campanha;
- testes unitarios, integrados e de frontend executados contra o PostgreSQL local em Docker;
- nenhuma migracao foi aplicada no Neon e nenhum deploy de producao foi realizado nesta etapa.
