# Cloudflare R2 para banners institucionais

## Escopo e limite de custo

Este projeto usa somente o Cloudflare R2 Standard para armazenar e servir imagens de banners.
Não habilite Cloudflare Images, Workers, Queues, Event Notifications, Smart Tiered Cache,
classe Infrequent Access ou qualquer produto adicional sem aprovação técnica e financeira.

Bucket atual:

- Bucket: `site-institucional`
- Prefixo lógico: `banners-institucional/`
- Classe: Standard
- Escrita: exclusivamente pela `api-ouvintes`
- Leitura: URL pública do bucket ou domínio CDN próprio

No R2, uma pasta é apenas um prefixo do nome do objeto. A API cria chaves imutáveis como:

```text
banners-institucional/2026/07/<uuid>.webp
```

## Configuração no painel Cloudflare

1. Abra R2 > `site-institucional` > Settings.
2. Em R2 API Tokens, crie credenciais S3 limitadas ao bucket `site-institucional`,
   com permissão de leitura e escrita de objetos. Não use token global.
3. Guarde o Access Key ID e Secret Access Key somente no ambiente da API.
4. Para produção, conecte um domínio próprio ao bucket, por exemplo
   `media.radio88fm.com.br`. O domínio `r2.dev` deve ser usado apenas em desenvolvimento.
5. Defina `R2_PUBLIC_BASE_URL` com o domínio público, sem barra final.
6. Não configure CORS para upload: o navegador envia o arquivo à API, e a API grava no R2.

O domínio público precisa estar ativo para que as tags `img` do institucional consigam ler os
objetos. O bucket pode permanecer sem listagem pública; somente URLs conhecidas são usadas.

## Variáveis da API

```env
MEDIA_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key-limitada-ao-bucket>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET_NAME=site-institucional
R2_PUBLIC_BASE_URL=https://media.seudominio.com.br
R2_OBJECT_PREFIX=banners-institucional
INSTITUTIONAL_BANNER_MAX_BYTES=10485760
```

Nunca use prefixo `VITE_` para secrets. O site e o painel conhecem apenas a URL da
`api-ouvintes`.

## Variável do site institucional

```env
VITE_GESTAO_OUVINTES_API_URL=https://api.seudominio.com.br
```

## Fluxo operacional

### Upload pelo painel

1. Administrador envia JPEG, PNG, WebP ou AVIF no painel.
2. A API limita o arquivo a 10 MiB, valida a assinatura binária, corrige orientação,
   redimensiona no máximo para 2400 x 1600 e converte para WebP.
3. A API grava uma chave imutável no R2 com cache de um ano.
4. PostgreSQL armazena somente `object_key` e metadados.
5. O endpoint público resolve `imageUrl` usando `R2_PUBLIC_BASE_URL`.
6. O site mantém o slide branco local e acrescenta apenas os banners ativos.

### Arquivo enviado manualmente ao R2

O formulário administrativo não solicita caminho interno do bucket. O fluxo oficial é sempre
upload de JPEG, PNG, WebP ou AVIF pelo painel, com processamento e registro realizados pela API.

O endpoint técnico de associação de objeto existente permanece reservado para migrações
controladas e não deve ser exposto na interface. SVGs legados enviados manualmente precisam ser
associados por operação assistida, com chave dentro de `banners-institucional/`.

## Diagnóstico seguro do R2

Com as variáveis da API configuradas, execute:

```bash
cd GestaoOuvintes/api-ouvintes
npm run r2:check
```

O comando gera uma imagem PNG em memória, converte para WebP pelo mesmo processador usado no
upload, grava no R2, valida o objeto e a URL pública e remove o arquivo em seguida. Nenhum secret
é impresso. O resultado esperado contém `R2 banner check completed`.

## Deploy e migração

Execute antes de iniciar a nova versão da API:

```bash
cd GestaoOuvintes/api-ouvintes
npm run db:migrate
npm run build
npm test
```

Sem as credenciais, mantenha `MEDIA_STORAGE_DRIVER=disabled`. A consulta pública retorna lista
vazia e o institucional usa seus banners estáticos de fallback. O upload administrativo retorna
erro controlado `MEDIA_STORAGE_NOT_CONFIGURED`.

## Backup e limpeza

- O banco é a fonte de verdade dos metadados e da ordem.
- Objetos não são sobrescritos.
- Ao trocar ou excluir um banner, o asset anterior vira `orphaned`.
- Não crie rotina automática de exclusão nesta fase. Revise e remova órfãos manualmente somente
  após 30 dias e após confirmar ausência de referência.
- Inclua PostgreSQL e inventário do bucket no procedimento de backup.
