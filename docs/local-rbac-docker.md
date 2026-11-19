# Painel RBAC local no Docker

O projeto Compose e `radio88-feed`, com servicos separados de painel, API, PostgreSQL e institucional. Nao agrupar quatro processos em um unico container. O painel usa Nginx e build estatico; nao depende de Vite rodando no Mac.

Com API e PostgreSQL existentes em execucao, a partir deste checkout Gestao:

```sh
docker compose -f compose.panel-local.yaml up -d --build panel
docker compose -f compose.panel-local.yaml ps panel
```

Acesso: http://127.0.0.1:5181/administracao/acessos/usuarios
API: http://127.0.0.1:3012/health

`restart: unless-stopped` reinicia o painel com o Docker Desktop, exceto se voce o parar explicitamente. Nao usar `down -v`, `--remove-orphans` nem recriar volumes: esse arquivo administra SOMENTE o painel do projeto existente. O compose completo continua em `compose.feed-preview.yaml` e precisa dos arquivos privados locais ja configurados.

Ao alterar o painel, repetir o build; um build Nginx nao recarrega o codigo-fonte automaticamente. Se a porta 5181 estiver ocupada por um Vite antigo, identificar e encerrar somente esse processo antes de subir o container.

Credenciais ficam fora da documentacao. As contas locais sao fixtures de teste; nao migrar usuarios, hashes ou sessoes para producao. O email das fixtures nao foi verificado e o login local deve usar username. Nenhum email externo foi enviado.

Validacao RBAC em 09/11: login Super Admin e Visualizador funcionaram; Visualizador nao recebe menu Acessos nem exportacoes. Super Admin pode administrar outro usuario, mas a conta raiz e o papel Admin sao protegidos contra alteracoes na propria tela.

O build do painel reportou 20 vulnerabilidades de dependencias (14 moderadas, 6 altas, incluindo dev); requer triagem antes de release. Nao foi executado npm audit fix/force nem houve publicacao remota.

## Plano 007 - API de programas local

A flag PROGRAMMING_ENABLED e false por padrao. O container API em uso foi iniciado com o override compose.programming-local.yaml; mantenha esse override ao recriar a API. A configuracao privada continua no checkout anterior, sem copia de segredos para o Git:

```sh
# Executar no checkout Gestao descrito acima.
FEED_ENV_DIR='/Users/joaomvalente/Downloads/ECOSSISTEMA - PORTAL/worktrees/plan-051-reconstruction/gestao'
docker build -t radio88-feed-api:local api-ouvintes
FEED_PREVIEW_IMAGE_ID=local-programming-validation docker compose \
  --env-file "$FEED_ENV_DIR/.env.feed-preview.local" \
  -f "$FEED_ENV_DIR/compose.feed-preview.yaml" \
  -f compose.programming-local.yaml up -d --no-deps api
docker compose -f compose.panel-local.yaml up -d --build panel
```

O Dockerfile original da API foi validado com npm ci apos corrigir somente a dependencia opcional @emnapi/runtime ausente no lockfile. Nao e mais necessario substituir npm ci por npm install. Nenhuma versao de dependencia existente foi atualizada.

Tela local: http://127.0.0.1:5181/programas. Contas locais anteriores preservadas. Migration 0019 ja aplicada no PostgreSQL Docker. API/painel mantem restart unless-stopped; sem dependencia de processo Vite no Mac.

## Institucional integrado / publicacao de programas

Migration 0020 tambem aplicada apenas localmente. Override compose.programming-local.yaml liga a publicacao e namespace preview/radio-88 na API e preserva o CORS estritamente local. O institucional precisa ser reconstruido com VITE_ON_AIR_ENABLED=true e VITE_PROGRAMMING_API_URL=http://127.0.0.1:3012: sao flags publicas de build, nao basta mudar ambiente do Nginx/servidor depois do build.

A partir do checkout institucional, reconstruir Dockerfile.feed-preview com os argumentos existentes FEED_RELEASE_BASE_URL/FEED_NAMESPACE e os dois VITE acima. Manter a URL publica R2 ja configurada; nunca passar chaves R2 como build args. A identidade do build inclui hash do index.html para nao servir uma release persistida antiga apos rebuild. O servidor de Preview preserva flags de runtime tambem nas publicacoes editoriais seguintes.

Recriar api e institutional usando compose.feed-preview.yaml privado com compose.programming-local.yaml, sem apagar volumes. Recriar painel por compose.panel-local.yaml. Servicos locais saudaveis: API 3012, painel 5181, institucional 8086 e PostgreSQL 55471. Sempre usar 127.0.0.1 nos links de teste; outro hostname exige CORS correspondente.

Fluxo: /programas no painel -> editar programa/foto/apresentadores -> configurar dias, horarios e vigencia -> salvar -> Publicar grade -> conferir Home e /programacao no institucional. Salvar nao publica automaticamente. Erro de publicacao permite Tentar novamente. Nomes publicos nao vinculam contas; usar gerenciamento de locutores para acesso.


## Sidebar e temas (11/11/2026)

O painel local usa Sidebar shadcn Radix com grupos e menu de usuario no rodape. A preferencia Claro/Escuro/Sistema guarda somente a escolha de tema no navegador, sem mudar acesso ou conta. Detalhes/testes e fallback de rebuild sem Docker Hub em [Fase 3](programacao-enquetes/fase-3-incrementos.md). A porta permanece http://127.0.0.1:5181/programas. Dados persistentes e outros servicos preservados.
