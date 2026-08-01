# Painel administrativo

Projeto: `GestaoOuvintes/painel-adm`

Tipo: WEB.

## Responsabilidade

O painel permite que a equipe consulte cadastros de ouvintes, gerencie campanhas e exporte bases autorizadas.

## Rotas

- `/login`
- `/ouvintes/cadastros`
- `/campanhas`

## Padroes de frontend

- React com componentes funcionais.
- TypeScript estrito.
- Data fetching via TanStack React Query.
- Rotas protegidas com React Router.
- Sessao curta em `sessionStorage`.
- Erros de API tratados por `ApiError`.
- Feedback operacional por Sonner.
- UI administrativa objetiva, densa e escaneavel.

## Responsabilidades dos arquivos

```text
src/
├── components/    # UI e layout compartilhados
├── contexts/      # AuthContext e estado de sessao
├── hooks/         # hooks locais
├── lib/           # utilitarios e formatadores
├── pages/         # telas roteadas
├── services/      # cliente de API e sessao
├── test/          # setup de testes
└── types/         # contratos TypeScript
```

## Regras de UX

- Estados de loading, vazio e erro devem existir em fluxos de dados.
- A tabela desktop deve ter alternativa em cards no mobile.
- Acoes administrativas devem ter feedback claro.
- Exportacao deve ser visivel apenas para `admin`.
- `viewer` pode visualizar, mas nao deve executar acoes sensiveis.

## Comandos

```bash
npm run dev
npm run lint
npm run build
npm test
```

## Variavel publica

```env
VITE_CADASTROS_API_URL=http://127.0.0.1:3010
```

Nao coloque JWT, senha ou segredo em variaveis `VITE_*`.

## Apuracao de sorteios

Campanhas do tipo `sweepstake` exibem a acao **Sortear** para usuarios com a permissao efetiva `sweepstake.draw`. A acao so e habilitada depois que a campanha esta encerrada.

O modal `SweepstakeDrawDialog`:

- consulta a elegibilidade e recupera um resultado existente;
- solicita o resultado a API com chave de idempotencia;
- usa nomes limitados apenas para animacao visual;
- revela nome, cidade, bairro e telefone do vencedor;
- permite ressorteio confirmado, preservando o resultado anterior;
- respeita `prefers-reduced-motion` e bloqueia fechamento durante a apuracao.
