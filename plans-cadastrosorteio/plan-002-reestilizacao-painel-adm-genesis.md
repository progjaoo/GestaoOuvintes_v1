# Plan 002 — Reestilização do painel-adm com referência Genesis

## 1. Contexto

O projeto `GestaoOuvintes` possui:

- `api-ouvintes`: backend Node.js/Fastify/PostgreSQL.
- `painel-adm`: frontend administrativo React/Vite/Tailwind.

A documentação base em `GestaoOuvintes/docs/README.md` define o ecossistema como **WEB/API**, com foco em segurança, Mobile First, qualidade e separação clara entre API e painel.

Este plano trata apenas da reestilização do `painel-adm`, mantendo o produto com o nome:

```text
Sistema de Gestão de Ouvintes
```

Referência visual solicitada:

```text
https://designmd.ai/chef/genesis
```

Skill instalada para apoio de frontend:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill
```

Skills instaladas em `.agents/skills`, com destaque para:

- `redesign-existing-projects`
- `design-taste-frontend`
- `high-end-visual-design`
- `minimalist-ui`

## 2. Agente recomendado

Agente principal:

```text
Frontend Design Engineer
```

Responsabilidades:

- Reestilizar o painel sem alterar regras de negocio.
- Trabalhar sobre React, Vite e Tailwind existentes.
- Preservar autenticação, listagem, filtros, exportação e gestão de campanhas.
- Aplicar visual inspirado no Genesis sem transformar o painel em landing page.

Agentes de apoio:

- `Mobile First Engineer`: validar layouts em 320px, 360px, 390px, 430px, 768px e desktop.
- `QA Engineer`: validar login, bootstrap, filtros, paginação, exportação e campanhas após a mudança visual.
- `Security Engineer`: garantir que nenhum token, senha ou PII seja exposto em UI, logs ou variáveis públicas.

## 3. Design read

Leitura do redesign:

```text
Painel administrativo B2B/operacional para equipe interna da Rádio 88 FM,
com linguagem editorial limpa e precisa, inspirada no Genesis, mantendo densidade
de dados, clareza e Mobile First.
```

Direção:

- Interface clara e editorial.
- Fundo off-white `#FAFAFA`.
- Superfícies brancas.
- Bordas sutis.
- Indigo apenas para ações, foco e estados ativos.
- Verde apenas para status positivo/ativo.
- Erros e alertas discretos, sem excesso visual.
- Menos sombras fixas; sombras apenas em hover/focus quando fizer sentido.
- Radius mais controlado: cards em 12px, botões/inputs em 6px ou 8px.

## 4. Objetivos

1. Reestilizar o `painel-adm` com base na estética Genesis.
2. Manter o nome visível como **Sistema de Gestão de Ouvintes**.
3. Preservar todos os fluxos atuais:
   - login;
   - criação do primeiro acesso;
   - rotas protegidas;
   - listagem de cadastros;
   - filtros;
   - paginação;
   - detalhes;
   - exportação CSV/XLSX;
   - gestão de campanhas.
4. Manter a arquitetura e stack atuais.
5. Melhorar consistência visual de tokens, tipografia, botões, inputs, tabelas, cards e estados.
6. Preservar Mobile First.

## 5. Fora do escopo

- Alterações na API `api-ouvintes`.
- Mudanças no schema do PostgreSQL.
- Novas regras de permissão.
- Novas funcionalidades de cadastro público.
- Reescrita do painel em outro framework.
- Instalação de design system pesado externo.

## 6. Referência Genesis adaptada ao painel

Tokens visuais da referência:

```text
Primary: #6366F1
Primary Hover: #4F46E5
Secondary: #20970B
Neutral: #9C9C9C
Background: #FAFAFA
Surface: #FFFFFF
Text Primary: #0A0A0A
Text Secondary: #6B6B6B
Border: #E8E8EC
Success: #10B981
Warning: #F59E0B
Error: #EF4444
```

Tipografia da referência:

- Headings: General Sans.
- Body: DM Sans.

Adaptação recomendada:

- Se as fontes forem adotadas, substituir os imports atuais em `src/index.css`.
- Caso se prefira evitar dependência externa nova neste ciclo, manter Archivo como fallback temporário e preparar tokens para migração.
- O plano recomenda aplicar General Sans/DM Sans por estar no template Genesis.

## 7. Arquivos afetados

Principais:

```text
GestaoOuvintes/painel-adm/src/index.css
GestaoOuvintes/painel-adm/tailwind.config.ts
GestaoOuvintes/painel-adm/src/components/layout/AppShell.tsx
GestaoOuvintes/painel-adm/src/pages/LoginPage.tsx
GestaoOuvintes/painel-adm/src/pages/RegistrationsPage.tsx
GestaoOuvintes/painel-adm/src/pages/CampaignsPage.tsx
```

Componentes UI:

```text
GestaoOuvintes/painel-adm/src/components/ui/Button.tsx
GestaoOuvintes/painel-adm/src/components/ui/Input.tsx
GestaoOuvintes/painel-adm/src/components/ui/Select.tsx
GestaoOuvintes/painel-adm/src/components/ui/Badge.tsx
GestaoOuvintes/painel-adm/src/components/ui/Dialog.tsx
GestaoOuvintes/painel-adm/src/components/ui/EmptyState.tsx
GestaoOuvintes/painel-adm/src/components/ui/LoadingBlock.tsx
```

Componentes de domínio:

```text
GestaoOuvintes/painel-adm/src/components/registrations/StatsCard.tsx
GestaoOuvintes/painel-adm/src/components/registrations/RegistrationFiltersPanel.tsx
GestaoOuvintes/painel-adm/src/components/registrations/RegistrationList.tsx
GestaoOuvintes/painel-adm/src/components/registrations/RegistrationDetailDialog.tsx
GestaoOuvintes/painel-adm/src/components/registrations/PaginationControls.tsx
GestaoOuvintes/painel-adm/src/components/campaigns/CampaignFormDialog.tsx
```

Testes possivelmente afetados por texto/estrutura:

```text
GestaoOuvintes/painel-adm/src/App.test.tsx
```

## 8. Estratégia visual

### 8.1 Tokens globais

Criar ou ajustar tokens no Tailwind para:

- `genesis-primary`: `#6366F1`
- `genesis-primary-hover`: `#4F46E5`
- `genesis-secondary`: `#20970B`
- `genesis-bg`: `#FAFAFA`
- `genesis-surface`: `#FFFFFF`
- `genesis-text`: `#0A0A0A`
- `genesis-muted`: `#6B6B6B`
- `genesis-border`: `#E8E8EC`
- `genesis-success`: `#10B981`
- `genesis-warning`: `#F59E0B`
- `genesis-error`: `#EF4444`

Manter cores da Rádio 88 apenas como presença de marca:

- logo;
- pequenos acentos contextuais;
- não dominar o painel inteiro.

### 8.2 Tipografia

Aplicar:

- `General Sans` para títulos e navegação.
- `DM Sans` para corpo, tabela, formulários e metadados.

Fallback:

```css
font-family: "DM Sans", "Archivo", sans-serif;
```

### 8.3 Layout

Trocar a sensação atual de sidebar escura dominante por uma interface mais clara e precisa:

- sidebar ou rail lateral com superfície clara ou off-white;
- header/topbar discreto;
- navegação ativa com indigo;
- conteúdo com max-width operacional;
- menos sombras permanentes;
- mais divisores e bordas sutis.

O painel não deve virar uma landing page. Ele precisa continuar denso, escaneável e eficiente.

### 8.4 Componentes

Botões:

- Primary indigo.
- Secondary/outline com borda sutil.
- Danger vermelho Genesis.
- Radius 6px ou 8px.
- Hover com mudança de cor e leve deslocamento/press.

Inputs/selects:

- Radius menor.
- Border `#E8E8EC`.
- Focus ring indigo.
- Altura consistente.

Cards:

- Radius 12px.
- Borda sutil.
- Sombra removida por padrão ou muito leve.
- Hover só onde houver ação.

Badges:

- Status `active` verde.
- `paused` amarelo.
- `closed/draft` cinza.
- Sem excesso de pill visual.

Tabela:

- Header mais editorial e limpo.
- Linhas com `divide-y`.
- Hover sutil.
- Números e datas com leitura fácil.

## 9. Plano de implementação

### Fase 1 — Auditoria e tokens

1. Revisar `tailwind.config.ts` e `src/index.css`.
2. Adicionar tokens Genesis.
3. Ajustar fontes globais.
4. Remover gradientes decorativos que conflitem com a referência.
5. Garantir `:focus-visible` acessível.

### Fase 2 — UI base

1. Reestilizar `Button`.
2. Reestilizar `Input`.
3. Reestilizar `Select`.
4. Reestilizar `Badge`.
5. Reestilizar `Dialog`.
6. Reestilizar `EmptyState` e `LoadingBlock`.

### Fase 3 — Shell do painel

1. Atualizar `AppShell`.
2. Exibir o nome **Sistema de Gestão de Ouvintes** no shell.
3. Ajustar navegação desktop.
4. Ajustar menu mobile.
5. Preservar logout e dados do usuário.
6. Garantir estado ativo claro em `/ouvintes/cadastros` e `/campanhas`.

### Fase 4 — Login e primeiro acesso

1. Reestilizar `LoginPage`.
2. Manter o fluxo de login.
3. Manter o botão `Criar primeiro acesso`.
4. Garantir que mensagens de erro e loading continuem claras.
5. Ajustar copy visual para o novo nome do sistema.

### Fase 5 — Cadastros

1. Reestilizar `RegistrationsPage`.
2. Ajustar `StatsCard` para visual Genesis.
3. Ajustar `RegistrationFiltersPanel`.
4. Ajustar `RegistrationList` desktop e mobile.
5. Preservar filtros, paginação e detalhes.
6. Preservar exportação CSV/XLSX para admin.

### Fase 6 — Campanhas

1. Reestilizar `CampaignsPage`.
2. Ajustar cards de campanhas com menor radius e borda sutil.
3. Reestilizar `CampaignFormDialog`.
4. Preservar criação/edição e restrição por role.

### Fase 7 — QA visual e funcional

1. Validar em 320px, 360px, 390px, 430px, 768px e desktop.
2. Validar sem scroll horizontal.
3. Validar teclado e foco.
4. Validar loading, vazio e erro.
5. Validar login, bootstrap, logout.
6. Validar filtros, detalhes, paginação, exportação e campanhas.

## 10. Critérios de aceite

- [ ] Painel exibe o nome **Sistema de Gestão de Ouvintes**.
- [ ] Visual geral segue a referência Genesis: claro, limpo, editorial, bordas sutis, indigo em interações.
- [ ] As cores antigas muito pesadas não dominam mais o painel.
- [ ] Botões, inputs, selects, badges, dialogs, tabelas e cards seguem o novo padrão.
- [ ] Login e criação do primeiro acesso continuam funcionando.
- [ ] Listagem de cadastros continua com filtros, paginação e detalhes.
- [ ] Exportação CSV/XLSX continua disponível para admin.
- [ ] Gestão de campanhas continua funcionando.
- [ ] Mobile First preservado.
- [ ] `npm run lint` passa.
- [ ] `npm run build` passa.
- [ ] `npm test` passa.

## 11. Validação obrigatória

Executar:

```bash
cd GestaoOuvintes/painel-adm
npm run lint
npm run build
npm test
```

Quando possível, validar também com a API ligada:

```bash
cd GestaoOuvintes/api-ouvintes
docker compose up -d
```

Depois abrir:

```text
http://localhost:5174
```

## 12. Riscos

- Trocar fonte por Google Fonts via `@import` mantém simplicidade, mas adiciona dependência externa de carregamento. Se isso for problema, self-host deve ser planejado depois.
- Uma mudança forte no shell pode quebrar testes por texto/role; atualizar testes apenas quando o comportamento continuar correto.
- O template Genesis usa indigo como cor primária; a marca Rádio 88 usa azul/vermelho/amarelo. A decisão aqui é usar Genesis como sistema operacional do painel e deixar a marca aparecer com parcimônia.
- O painel manipula dados pessoais. A reestilização não pode adicionar PII em analytics, logs ou mensagens públicas.

## 13. Observações de implementação

- Não alterar `api-ouvintes`.
- Não alterar contrato de endpoints.
- Não mover regras de permissão para o frontend.
- Não instalar bibliotecas visuais novas sem necessidade.
- Trabalhar com Tailwind e componentes existentes.
- Fazer mudanças em blocos pequenos para facilitar revisão.
