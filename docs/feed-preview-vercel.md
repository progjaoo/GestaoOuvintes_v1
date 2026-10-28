# Feed: homologacao Vercel isolada

Atualizado em 28/10/2026. Responsaveis: DevOps/Release, Security e QA.

## Destinos

- Branch dos dois repositorios: `preview/plan-051-feed-editorial`.
- API: `https://gestaoouvintes88fm-api-git-pr-ad7f0a-mosaicolabs-4518s-projects.vercel.app`.
- Painel: `https://gestaoouvintes88fm-git-previe-2f0a70-mosaicolabs-4518s-projects.vercel.app`.
- Institucional: `https://radio-88fm-institucional-git-preview-d394a4-radio-88s-projects.vercel.app/feed`.
- API/painel pertencem a `mosaicolabs-4518s-projects`; institucional pertence a `radio-88s-projects`.
- Neon: projeto `blue-fire-95571419`, branch `br-green-shape-axqkgnsc`, nome `plan-051-feed-preview-20261027`.
- Buckets: `radio88-feed-preview-private` e `radio88-feed-preview-public`.
- Namespace: `preview/radio-88`.

O Preview nao compartilha ouvintes, banco, segredos de autenticacao nem buckets de producao. A branch Neon foi criada somente com schema. Migrations presentes: 0001 a 0006, 0013, 0014 e 0015. Nesta rodada somente a 0015 foi aplicada; o usuario sintetico de teste e seu papel administrativo foram populados separadamente.

## Configuracao

Na API, variaveis de Preview recebem conexao direta da branch Neon (nao pooled, devido aos advisory locks de sessao), pool maximo 2, SSL e credenciais R2 exclusivas. Nunca copiar esses valores ao painel ou institucional.

Variaveis da publicacao: `FEED_ENABLED`, `FEED_PUBLICATION_ENABLED`, `FEED_NAMESPACE`, `FEED_PRIVATE_BUCKET_NAME`, `FEED_DEPLOY_HOOK_URL`, `FEED_SITE_BASE_URL` e `FEED_SITE_PROTECTION_BYPASS_SECRET`. Hook e bypass sao segredos server-only. O hook `radio88-feed-preview-editorial` aponta exclusivamente para a branch de Preview.

O segredo de automacao da Vercel e persistente e tecnicamente tem alcance no projeto institucional inteiro; seu uso ficou restrito a API Preview. Ele deve ser revogado ao encerrar a homologacao. Nenhuma protecao global foi desativada.

No painel: `VITE_CADASTROS_API_URL` aponta para a API acima e `VITE_FEED_SITE_BASE_URL` para a origem do institucional Preview. O botao Ver nunca deve abrir `/feed` na origem do painel. Sem base publica valida, esse atalho nao e exibido.

No institucional, `FEED_RELEASE_BASE_URL` aponta ao bucket publico de teste e `FEED_NAMESPACE=preview/radio-88`. Overrides sao especificos da branch. GA, cadastro de ouvintes e banners dinamicos ficaram desativados nesse Preview; nao refletem as flags de Production. A Vercel adiciona `X-Robots-Tag: noindex` aos deploys Preview.

O CORS da API permite as origens exatas do painel; inclui `PATCH` para edicoes. O bucket privado permite GET/HEAD/PUT, cabecalho Content-Type, ETag exposto e max-age 300, somente para o alias do painel acima, localhost:5181 e 127.0.0.1:5181. Nao habilitar acesso publico no bucket privado nem liberar origens com `*`.

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

- Neon Preview: expira em 04/11/2026 as 14:39 BRT.
- Token R2 restrito: expira em 27/11/2026.
- Link temporario do painel: sete dias a partir de 28/10/2026. O link e uma credencial de acesso ao deploy; nao registrar sua query em documentos ou commits.
- Bypass de automacao: revogacao manual obrigatoria ao encerrar os testes; remover tambem a variavel server-only e o hook de Preview quando nao forem mais necessarios.

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
