# Feed: homologacao Vercel isolada

Atualizado em 05/11/2026. Responsaveis: DevOps/Release, Security e QA.

## Destinos

- Branch dos dois repositorios: `preview/plan-051-feed-editorial`.
- API: `https://gestaoouvintes88fm-api-git-pr-ad7f0a-mosaicolabs-4518s-projects.vercel.app`.
- Painel: `https://gestaoouvintes88fm-git-previe-2f0a70-mosaicolabs-4518s-projects.vercel.app`.
- Institucional: `https://radio-88fm-institucional-git-preview-d394a4-radio-88s-projects.vercel.app/feed`.
- API/painel pertencem a `mosaicolabs-4518s-projects`; institucional pertence a `radio-88s-projects`.
- Neon permanente de Preview: projeto `lucky-king-59752997` (`gestao-ouvintes-feed-preview`), branch padrao `br-rapid-unit-bdlk9tcs`, banco `radio88_preview`, papel `radio88_preview_owner`. Nao possui expiracao configurada.
- A antiga branch `br-green-shape-axqkgnsc` expirou e nao deve ser reutilizada como destino de conexao.
- Buckets: `radio88-feed-preview-private` e `radio88-feed-preview-public`.
- Namespace: `preview/radio-88`.

O Preview nao compartilha ouvintes, banco, segredos de autenticacao nem buckets de producao. O projeto Neon novo foi criado vazio em 05/11/2026, sem copiar dados de producao. Migrations presentes: 0001 a 0006 e 0013 a 0016. A `0016_editorial_promo_cta.sql` foi aplicada em `br-rapid-unit-bdlk9tcs` para armazenar texto e destino da chamada comercial por revisao. O mesmo login/senha de homologacao foi recriado a partir do arquivo privado local; rascunhos do banco expirado nao foram recuperados.

Compute fixo minimo de 0.25 CU, com suspensao automatica pelo padrao Neon (300 segundos; suspend_timeout_seconds=0 herda esse padrao). Sem expiracao nao significa sem custo ou disponibilidade garantida: observar quotas, suspensao e validade das credenciais.

## Configuracao

Na API, variaveis de Preview recebem conexao direta da branch Neon (nao pooled, devido aos advisory locks de sessao), pool maximo 2, SSL e credenciais R2 exclusivas. Nunca copiar esses valores ao painel ou institucional.

Em 05/11 a DATABASE_URL geral de Preview e o override do branch preview/plan-051-feed-editorial foram atualizados para o mesmo banco permanente isolado. Production nao foi editada. Novas alteracoes devem editar as entradas existentes, nao adicionar outra DATABASE_URL. Recarregar a lista do Vercel apos salvar: uma lista desatualizada ocultou uma entrada criada e gerou erros de duplicidade. A copia privada local da conexao fica em .env.feed-preview.vercel.local (ignorada pelo Git, permissao 0600).

Variaveis da publicacao: `FEED_ENABLED`, `FEED_PUBLICATION_ENABLED`, `FEED_NAMESPACE`, `FEED_PRIVATE_BUCKET_NAME`, `FEED_DEPLOY_HOOK_URL`, `FEED_SITE_BASE_URL` e `FEED_SITE_PROTECTION_BYPASS_SECRET`. Hook e bypass sao segredos server-only. O hook `radio88-feed-preview-editorial` aponta exclusivamente para a branch de Preview.

O segredo de automacao da Vercel e persistente e tecnicamente tem alcance no projeto institucional inteiro; seu uso ficou restrito a API Preview. Ele deve ser revogado ao encerrar a homologacao. Nenhuma protecao global foi desativada.

No painel: `VITE_CADASTROS_API_URL` aponta para a API acima e `VITE_FEED_SITE_BASE_URL` para a origem do institucional Preview. O botao Ver nunca deve abrir `/feed` na origem do painel. Sem base publica valida, esse atalho nao e exibido.

No institucional, `FEED_RELEASE_BASE_URL` aponta ao bucket publico de teste e `FEED_NAMESPACE=preview/radio-88`. Overrides sao especificos da branch. GA, cadastro de ouvintes e banners dinamicos ficaram desativados nesse Preview; nao refletem as flags de Production. A Vercel adiciona `X-Robots-Tag: noindex` aos deploys Preview.

O CORS da API permite as origens exatas do painel; inclui `PATCH` para edicoes. O bucket privado permite GET/HEAD/PUT, cabecalho Content-Type, ETag exposto e max-age 300, somente para o alias do painel acima, localhost:5181, 127.0.0.1:5181 e a URL unica https://gestaoouvintes88fm-l9nmczaih-mosaicolabs-4518s-projects.vercel.app (adicionada em 05/11 apos falha de upload por essa origem). Nao habilitar acesso publico no bucket privado nem liberar origens com `*`. Preferir o alias estavel, cuja origem nao muda em novos builds.

Em 05/11 o upload real de PNG com edicao para WebP foi validado tambem pela URL unica l9nmczaih: arquivo pronto e thumbnail carregada. CORS confirmado persistido no Cloudflare; bucket continua privado. Nao houve deploy, migration, alteracao salva na materia ou publicacao nesta correcao. Tentativas anteriores pendentes nao foram apagadas; reenviar arquivos que falharam. Biblioteca consulta registros do banco e le arquivos privados por URLs assinadas, nao lista todos os objetos do R2 livremente.

## Uso pelo designer

1. Abrir o link temporario do painel fornecido em canal privado ou autenticar-se na Vercel. A protecao da Vercel nao substitui o login administrativo do CMS.
2. Fazer login com uma conta de homologacao; o usuario sintetico `feed-preview` nao e uma credencial de producao. Senhas permanecem nos arquivos privados/envs, nunca neste guia.
3. Abrir Conteudo do Feed, criar categoria e Nova materia.
4. Informar Data do acontecimento para agrupar o ano. Sem data, o item aparece em Sem data. Publicacao continua registrada para auditoria/SEO, mas nao aparece como data do card.
5. Preparar capa do card em 1260 x 900 (7:5) e abertura em 1920 x 1080 (16:9). Corpo/galeria: 1920 px de largura preservando proporcao; posters GIF/video: 1920 x 1080. Recomendacoes nao impedem uso de acervo com outros tamanhos.
6. Enviar midias, salvar rascunho e conferir a pre-visualizacao Desktop/Mobile. Rascunhos e originais permanecem privados.
7. Solicitar publicacao. Isso copia midias aprovadas ao bucket publico Preview e aciona o build do institucional. Nao significa publicacao em Production.
8. Quando o build terminar, clicar em Atualizar situacao. Somente NO AR confirma a release no dominio. A consulta e manual: nao existe polling continuo.
9. Para retirar, usar Retirar e confirmar a nova release; ate o deploy terminar, a versao anterior continua no ar.

Materias e midias sinteticas identificadas como QA nao devem ser publicadas em producao. O teste de 2025 foi arquivado; o de 2026 permanece visivel somente no Preview para demonstracao.

## Validade e acesso

- Neon Preview atual: sem expiracao configurada. Nao recriar banco/branch a cada sessao nem usar o destino expirado de 04/11.
- Token R2 restrito: expira em 27/11/2026.
- Link temporario do painel: sete dias a partir de 28/10/2026. O link e uma credencial de acesso ao deploy; nao registrar sua query em documentos ou commits.
- Bypass de automacao: revogacao manual obrigatoria ao encerrar os testes; remover tambem a variavel server-only e o hook de Preview quando nao forem mais necessarios.

## Reutilizacao permanente e teste de recuperacao - 05/11/2026

1. Reutilizar os tres aliases de branch em Destinos; URLs unicas mudam em cada deploy e nao devem ser enviadas como endereco principal ao designer.
2. Em falha, conferir bootstrap-status, logs da API, DATABASE_URL existente e estado do compute. Nao criar novo banco como primeira tentativa.
3. Rotacionar segredos somente no ambiente de Preview, atualizar as entradas existentes no Vercel e fazer redeploy Preview da API. Nao usar Rotate global de uma chave homonima: o dialogo pode abranger Production e Preview.
4. Renovar o token R2 antes de 27/11/2026 nos mesmos dois buckets e atualizar a API Preview. Renovar credenciais nao exige novo bucket, banco ou projeto Vercel.
5. Login no painel, upload, salvar rascunho, solicitar publicacao, aguardar build e clicar Atualizar situacao. Somente no ar e marcador exato confirmam a entrega.
6. O institucional NAO recebe DATABASE_URL: no build le o manifesto publico R2 do namespace preview/radio-88; visitantes recebem HTML/JSON/midias estaticos. O Deploy Hook existente da outra conta Vercel foi validado sem criar outro projeto nem mudar Production.
7. Conteudo aprovado para Production exige transferencia editorial e release separados. Promover este deploy de Preview nao transfere dados nem configura ambientes corretamente.

Evidencia: API redeploy dpl_GEQxd9TnDaBG2PWfZn8xz8Nfq6mn, mesmo commit 2bd5939 e branch. Bootstrap retornou canBootstrap=false; login com a credencial privada anterior funcionou; categoria Homologacao criada; upload real de PNG ao R2 privado concluido; rascunho bed8c597-c276-4b02-ac7b-40a90d9ca473 persistido; release 2c6c61f3-9e15-4500-a4f3-3e453d34bc55 confirmada no painel como no ar e no marcador do institucional. A materia qa-preview-permanente-20261105 abriu no alias estavel com imagem e texto. Conteudo explicitamente QA, somente Preview. Essa primeira release do banco novo substituiu a antiga listagem estatica do Preview.

Limites: nesta recuperacao foi testado PNG/texto/publicacao/confirmacao. GIF, MP4, dispositivos reais, ociosidade de compute e acesso externo sem sessao Vercel nao foram revalidados. O antigo link compartilhavel tinha validade de sete dias; autenticar-se na Vercel se a protecao do deploy pedir. Nao foi desativada protecao global nem criado link permanente de bypass.

## Evidencias e gates

Em 28/10: login e salvamento visual; upload real de PNG 1260x900, PNG 1920x1080, GIF e MP4; publicacao via hook, confirmacao pelo marcador, filtros 2025/2026, ordem por acontecimento, retry idempotente e retirada confirmada. HTML e JSON do slug retirado retornaram 404 e o sitemap removeu esse slug. Artigo ativo tem HTML prerenderizado e canonical da origem de producao, enquanto o header noindex impede indexacao do Preview. Nenhuma requisicao a API Gestao foi observada na navegacao publica testada. Mobile 390 px sem overflow; MP4 sintetico reproduziu por 2 segundos.

Ainda nao concluiram: janela ociosa de 15 minutos com evidencia de compute; matriz completa de navegadores/dispositivos e acessibilidade; indisponibilidade controlada; concorrencia/rollback em ambiente remoto; matriz negativa completa de papeis; revisao e correcao das dependencias vulneraveis. Os testes unitarios de falhas nao substituem esses ensaios reais.

`npm audit` do painel: 14 alertas (7 altos, 7 moderados); com `--omit=dev`, 3 alertas (Zod alto e React Router/React Router DOM moderados). Ferramentas de build/teste concentram os demais. O painel e estatico e nao publica servidores Vite/Vitest, mas isso nao elimina o risco na cadeia de build. Nao foi executado audit fix. Corrigir em mudanca revisada, com regressao do editor/login/rotas, antes da liberacao final de producao.

## Producao e conteudo aprovado

Promover um deploy nao transfere conteudo entre bancos/buckets. Nao promover este Preview isolado diretamente como se fosse um build de producao: flags, URLs e storage sao diferentes.

O release de producao exige aprovacao separada, migrations revisadas no destino correto, credenciais e namespace de Production, transferencia editorial explicita de conteudo aprovado e um build de producao testado antes de atribuir o dominio. Nenhuma dessas operacoes de producao foi executada nesta rodada.

## Ajustes editoriais do designer - 28/10/2026

- O formulario nao exige mais descricoes manuais de capa, abertura, imagens, galerias ou GIFs. O payload preserva descricoes antigas e gera um fallback contextual a partir do titulo/legenda quando faltar, sem remover alt/semantica/teclado do leitor publico. Nenhuma migration ou mudanca no contrato da API.
- Ao escolher uma imagem estatica para upload, abre o editor nativo do painel: proporcao Original, 7:5, 16:9 ou 1:1, ampliacao, posicao e giro de 90 graus. Aplicar e enviar cria um novo WebP (ou PNG em navegadores sem encoder WebP), passando pela mesma validacao/checksum/upload privado da API. Enviar original continua disponivel. GIF e MP4 nao sao rasterizados pelo editor.
- Imagens selecionadas podem ser editadas novamente em capa, abertura, corpo, galeria e poster. Uma nova midia e criada; nao sobrescrever arquivos ou revisoes publicados. Salvar o rascunho continua necessario.
- Pre-visualizar abre uma nova aba autenticada com Desktop/Mobile. O rascunho nao salvo e enviado por BroadcastChannel somente em memoria; nao vai em query string, localStorage ou bucket publico. Recarregar apos cinco minutos exige reabrir pelo editor. Bloqueio de pop-up exibe orientacao.
- GIF inicia automaticamente sem botao de reproducao; a preferencia de movimento reduzido do dispositivo continua respeitada com poster estatico.
- O institucional apresenta Post Anterior / Proximo Post no fim da materia, na mesma ordem global por Data do acontecimento do Feed (recentes primeiro, desempate por slug, sem data por ultimo). Extremos ficam desabilitados, sem retorno circular ao inicio nem consultas a API/Neon.
- Atualizar a mesma branch Preview preserva os aliases ja enviados ao designer. A URL unica de cada deploy muda, mas o alias de branch nao. Nao promover Preview a Production.

## Recuperacao editorial - 03/11/2026

Uma release de 28/10 estava awaiting_confirmation embora o marcador do site ja correspondesse a ela. O check autenticado confirmou essa release sem apagar travas ou rascunhos. Agora a API reconcilia automaticamente uma release pendente pelo marcador exato antes de nova publicacao, sob o lock do namespace. Se o marcador estiver indisponivel/diferente, o bloqueio permanece e retorna releaseId/status para recuperacao manual.

O editor recupera a ultima release pendente ao abrir (uma requisicao, sem polling), permite conferir/retomar a mesma revisao e impede publicar alteracoes ainda nao salvas. Erros de validacao passam a indicar o campo/bloco em alerta persistente, preservando o formulario. Blocos de imagem/GIF/galeria/video incompletos sao identificados antes do envio. Nao foi relaxada a validacao do servidor nem criada migration.
