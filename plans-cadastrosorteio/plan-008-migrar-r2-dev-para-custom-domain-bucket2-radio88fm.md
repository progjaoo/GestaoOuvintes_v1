# Migrar R2 Dev para Custom Domain `bucket2.radio88fm.com`

**Objetivo:** substituir a URL publica de desenvolvimento `https://pub-d9c3f2ecb5ec4d21846215ee6c91d3de.r2.dev` pelo subdominio `https://bucket2.radio88fm.com`, mantendo o fluxo atual de upload via `api-ouvintes`, consumo dos banners pelo site institucional e fallback local em caso de falha.

**Stack:** Cloudflare R2, Cloudflare DNS/Custom Domains, Vercel, Node.js/Fastify, React/Vite, PostgreSQL/Neon.

**Agentes recomendados:** Tech Lead / Arquiteto, DevOps / Release Engineer, Security Engineer, Backend API Engineer, Institutional Frontend Engineer, QA Engineer e Documentation Engineer.

## 1. Decisao Tecnica

E possivel usar `bucket2.radio88fm.com` como dominio publico do bucket R2, desde que esse host seja conectado ao bucket em **Cloudflare R2 > bucket `site-institucional` > Settings > Custom Domains**.

O ponto importante: nao basta criar um CNAME manual apontando para `pub-...r2.dev`. A documentacao da Cloudflare informa que o `r2.dev` e destinado a desenvolvimento, tem limitacao de taxa e nao suporta os recursos de producao como cache, WAF, Access e regras do Cloudflare. Para producao, o bucket deve ser conectado por Custom Domain.

## 2. Situacao Atual

- Bucket R2: `site-institucional`.
- Prefixo dos banners: `banners-institucional`.
- URL publica atual de teste: `https://pub-d9c3f2ecb5ec4d21846215ee6c91d3de.r2.dev`.
- Site institucional publicado: `https://www.radio88fm.com/`.
- Subdominio desejado: `bucket2.radio88fm.com`.
- Painel administrativo: `GestaoOuvintes/painel-adm`.
- API que grava no R2 e resolve URLs publicas: `GestaoOuvintes/api-ouvintes`.

## 3. Premissas de Seguranca

- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` e `DATABASE_URL` continuam somente no projeto Vercel da API `gestaoouvintes88fm-api`.
- O painel e o institucional nao recebem secrets do R2.
- O banco deve continuar armazenando apenas `object_key`; a URL publica e montada pela API com `R2_PUBLIC_BASE_URL`.
- A URL publica do CDN sempre sera visivel no navegador. Isso e esperado para imagens publicas. O ganho de seguranca vem de nao expor secrets e de usar um dominio sob controle da radio com cache/WAF.
- O `r2.dev` deve ser desativado somente depois que `bucket2.radio88fm.com` estiver ativo, testado e consumido pela API.

## 4. Validacao de DNS Antes de Conectar

### 4.1 Confirmar onde o DNS de `radio88fm.com` e gerenciado

Verificar se `radio88fm.com` esta como zona ativa na mesma conta Cloudflare onde esta o bucket R2.

Se a zona estiver no Cloudflare:

- Prosseguir com **R2 > Settings > Custom Domains > Add**.
- Informar `bucket2.radio88fm.com`.
- Deixar a Cloudflare criar/gerenciar o registro DNS necessario.

Se o DNS ainda estiver na Locaweb/cPanel:

- Nao apontar `bucket2.radio88fm.com` manualmente para `pub-...r2.dev`.
- Escolher uma das opcoes:
  - **Opcao recomendada:** migrar a zona DNS de `radio88fm.com` para Cloudflare, replicando antes todos os registros atuais (`A`, `CNAME`, `MX`, `TXT`, email, webmail, SPF/DKIM/DMARC se existirem).
  - **Opcao alternativa:** configurar o dominio em Cloudflare via setup parcial/CNAME setup, caso disponivel no plano/conta, para permitir que o R2 valide e controle o subdominio.

### 4.2 Revisar impacto nos registros atuais

Antes de mudar nameservers ou delegacao:

- Exportar/printar todos os registros DNS atuais.
- Preservar o `A` raiz atual, caso o dominio principal ainda aponte para hospedagem externa.
- Preservar `www`, MX e todos os registros de email da Locaweb.
- Confirmar se `www.radio88fm.com` continuara apontando para Vercel ou para o provedor atual.

## 5. Conectar `bucket2.radio88fm.com` ao R2

No Cloudflare:

1. Acessar **R2 Object Storage**.
2. Abrir o bucket `site-institucional`.
3. Ir em **Settings**.
4. Em **Custom Domains**, clicar em **Add**.
5. Informar `bucket2.radio88fm.com`.
6. Confirmar a criacao do dominio.
7. Aguardar status:
   - Ownership: `active`.
   - SSL: `active`.
   - Domain enabled/public access: `allowed` ou equivalente.

Observacao: o print mostra `Certificado SSL: Inativo` no painel de dominio externo. Para o R2 Custom Domain, o SSL que importa e o SSL emitido/gerenciado pela Cloudflare para `bucket2.radio88fm.com`.

## 6. Testes Diretos do Novo Dominio

Escolher um objeto existente no R2, por exemplo:

```text
banners-institucional/2026/07/<arquivo>.webp
```

Testar:

```bash
curl -I https://bucket2.radio88fm.com/banners-institucional/2026/07/<arquivo>.webp
```

Resultado esperado:

- `HTTP/2 200` ou `HTTP/3 200`.
- `content-type: image/webp`.
- Sem redirecionar para `r2.dev`.
- Sem erro SSL.

Testar tambem um objeto inexistente:

```bash
curl -I https://bucket2.radio88fm.com/banners-institucional/nao-existe.webp
```

Resultado esperado:

- `404`, sem listar conteudo do bucket.

## 7. Atualizar Variaveis no Vercel

### 7.1 Projeto `gestaoouvintes88fm-api`

Alterar em **Production** e **Preview**, se o preview tambem deve testar R2 real:

```env
R2_PUBLIC_BASE_URL=https://bucket2.radio88fm.com
```

Manter sem alteracao:

```env
MEDIA_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET_NAME=site-institucional
R2_OBJECT_PREFIX=banners-institucional
INSTITUTIONAL_BANNER_MAX_BYTES=10485760
```

Nao adicionar essas variaveis ao `painel-adm` ou ao `radio-88-fm-institucional`, exceto URLs publicas de API que ja existem.

### 7.2 Redeploy obrigatorio

Depois de mudar `R2_PUBLIC_BASE_URL`, fazer redeploy do projeto:

```text
gestaoouvintes88fm-api
```

Sem redeploy, a Function publicada pode continuar usando a URL antiga.

## 8. Validar API Publica de Banners

Executar:

```bash
curl -s https://gestaoouvintes88fm-api.vercel.app/api/public/institutional-banners?placement=home_hero
```

Validar no JSON:

- Os banners ativos aparecem ordenados por `displayOrder`.
- `imageUrl` deve iniciar com `https://bucket2.radio88fm.com/`.
- Nenhum `imageUrl` deve retornar `pub-d9c3f2ecb5ec4d21846215ee6c91d3de.r2.dev`.
- O banco continua com `object_key`, nao com URL absoluta.

Se o endpoint ainda retornar `r2.dev`:

- Confirmar se o redeploy da API usou as envs novas.
- Confirmar se existe cache no cliente.
- Confirmar se a API nao esta persistindo URL absoluta em alguma coluna antiga.

## 9. Validar Painel Administrativo

No `painel-adm` publicado:

1. Abrir a tela **Banners institucionais**.
2. Confirmar que as imagens carregam pelo novo dominio.
3. Criar um novo banner raster (`JPEG`, `PNG`, `WebP` ou `AVIF`).
4. Confirmar que o upload passa pela API.
5. Confirmar no Cloudflare R2 que o novo objeto foi criado dentro de `banners-institucional/YYYY/MM/`.
6. Confirmar que o banner novo aparece ao final da ordem.
7. Editar link e status do banner sem substituir imagem.

Resultado esperado:

- Upload continua usando as secrets somente no backend.
- A imagem publicada retorna `https://bucket2.radio88fm.com/...`.
- O painel nao mostra nem exige caminho manual do R2 para imagens comuns.

## 10. Validar Site Institucional

No `radio-88-fm-institucional` publicado em `https://www.radio88fm.com/`:

1. Abrir DevTools > Network.
2. Recarregar a Home.
3. Procurar requisição do endpoint publico de banners.
4. Confirmar que os banners remotos carregam depois do banner branco fixo.
5. Confirmar que as imagens remotas usam `bucket2.radio88fm.com`.
6. Confirmar que o fallback local continua funcionando se a API falhar.

Variavel esperada no Vercel do institucional:

```env
VITE_CADASTROS_API_URL=https://gestaoouvintes88fm-api.vercel.app
```

Nao configurar `R2_PUBLIC_BASE_URL` no institucional se ele ja consome `imageUrl` pronto da API.

## 11. Configuracoes Recomendadas no Cloudflare

Depois que o dominio estiver ativo:

- Criar Cache Rule para `bucket2.radio88fm.com/banners-institucional/*`.
- Usar cache longo para assets versionados/imutaveis, pois cada upload gera chave nova.
- Criar regra WAF simples para bloquear metodos diferentes de `GET`, `HEAD` e `OPTIONS` nesse host publico.
- Desabilitar directory listing, se qualquer configuracao vier a permitir listagem.
- Monitorar requests e cache hit ratio no Cloudflare.
- Manter alertas de uso/custo do R2.

## 12. Desativar `r2.dev`

Somente depois dos testes:

1. Ir em **R2 > site-institucional > Settings**.
2. Em **Public Development URL**, clicar em **Disable**.
3. Confirmar digitando `disallow`, se solicitado.
4. Testar que `https://pub-d9c3f2ecb5ec4d21846215ee6c91d3de.r2.dev/...` nao responde mais publicamente.
5. Testar que `https://bucket2.radio88fm.com/...` continua respondendo.

## 13. Rollback

Se o custom domain falhar em producao:

1. Reabilitar temporariamente o `r2.dev`.
2. Voltar `R2_PUBLIC_BASE_URL` da API para:

```env
https://pub-d9c3f2ecb5ec4d21846215ee6c91d3de.r2.dev
```

3. Fazer redeploy da API.
4. Manter o fallback local do institucional ativo.
5. Corrigir SSL/DNS/Custom Domain antes de tentar novamente.

## 14. Checklist de Aceite

- [ ] `bucket2.radio88fm.com` conectado ao bucket `site-institucional` como Custom Domain no R2.
- [ ] SSL do custom domain ativo no Cloudflare.
- [ ] Um objeto existente abre por `https://bucket2.radio88fm.com/...`.
- [ ] Objeto inexistente retorna `404` sem listar bucket.
- [ ] `R2_PUBLIC_BASE_URL` alterado no projeto Vercel `gestaoouvintes88fm-api`.
- [ ] API redeployada apos alterar env.
- [ ] Endpoint publico de banners retorna `imageUrl` com `bucket2.radio88fm.com`.
- [ ] Painel consegue criar banner novo e visualizar a imagem pelo novo dominio.
- [ ] Institucional carrega banners remotos pelo novo dominio.
- [ ] `r2.dev` desativado apos homologacao.
- [ ] Nenhum secret R2 aparece em bundle React, DevTools, logs ou resposta publica.

## 15. Observacoes

- Ver `bucket2.radio88fm.com` ou qualquer URL publica no DevTools e normal, porque o navegador precisa baixar as imagens. O que nao pode aparecer sao `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DATABASE_URL`, `JWT_SECRET` ou tokens administrativos.
- Se o dominio `radio88fm.com` nao estiver como zona Cloudflare, a etapa mais sensivel sera a decisao de migrar DNS ou configurar setup parcial. Essa decisao deve preservar email e registros atuais.
- O nome `bucket2` funciona tecnicamente, mas para comunicacao e manutencao futura um nome como `media.radio88fm.com` ou `cdn.radio88fm.com` costuma ser mais claro. Se mantiver `bucket2`, documentar que ele e o host publico de midias institucionais.
