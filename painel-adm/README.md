# Painel Administrativo de Ouvintes

Frontend administrativo separado para consultar e gerenciar os cadastros de ouvintes da Rádio 88 FM.

Consome a API localizada em `../api-ouvintes`.

## Funcionalidades

- Login administrativo com JWT.
- Sessão curta em `sessionStorage`.
- Rotas protegidas.
- Encerramento automático da sessão em `401`.
- Indicadores de total, contatos com telefone e resultado filtrado.
- Filtros por campanha, nome, cidade, bairro, período e telefone.
- Listagem paginada.
- Tabela desktop e cards Mobile First.
- Detalhes do cadastro.
- Exportação CSV e XLSX gerada pela API.
- Gestão de campanhas.
- Restrições visuais por função `admin` ou `viewer`.
- Estados de loading, erro e vazio.

## Stack

- React 18.
- TypeScript estrito.
- Vite.
- Tailwind CSS.
- TanStack React Query.
- React Router.
- Radix Dialog.
- Sonner.
- Vitest e Testing Library.

## Desenvolvimento

1. Garanta que a API esteja ativa:

```bash
cd ../api-ouvintes
docker compose up -d
```

2. Configure o painel:

```bash
cp .env.example .env.local
```

3. Instale e execute:

```bash
npm install
npm run dev
```

Painel:

```text
http://localhost:5174
```

API:

```text
http://127.0.0.1:3010
```

O usuário inicial é definido no `.env` da API:

```env
ADMIN_INITIAL_USERNAME=
ADMIN_INITIAL_PASSWORD=
```

Em um banco novo sem usuários administrativos, a tela de login exibe o botão
`Criar primeiro acesso`. Depois que o primeiro admin é criado, esse fluxo é
bloqueado pela API.

## Variáveis

```env
VITE_CADASTROS_API_URL=https://cadastros-api.dominio
```

Variáveis `VITE_*` são públicas no bundle. Nunca coloque JWT, senha ou segredo
nesse arquivo.

## Validação

```bash
npm run lint
npm run build
npm test
```

## Deploy estático

### Vercel

Configure:

- Root Directory: `radio-88-fm-institucional/painel-adm`
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable: `VITE_CADASTROS_API_URL`

O `vercel.json` contém o fallback de SPA.

### Docker/Nginx

```bash
docker build \
  --build-arg VITE_CADASTROS_API_URL=https://cadastros-api.dominio \
  -t radio88-cadastros-admin .

docker run --rm -p 8082:80 radio88-cadastros-admin
```

## Segurança

- O painel não contém credenciais fixas.
- Senhas nunca são persistidas.
- JWT fica somente em memória/sessionStorage.
- `401` encerra a sessão.
- Exportações são feitas pela API e auditadas no PostgreSQL.
- PII não deve ser enviada ao GA4.
- Produção precisa de HTTPS.
- O domínio do painel deve ser incluído em `CORS_ALLOWED_ORIGINS` da API.

## Mobile First

Validar em:

- 320px.
- 360px.
- 390px.
- 430px.
- 768px.
- 1280px ou superior.

No mobile:

- sidebar vira menu inferior/modal;
- tabela vira cards;
- filtros podem ser recolhidos;
- ações mantêm área confortável para toque;
- diálogos usam rolagem interna.
