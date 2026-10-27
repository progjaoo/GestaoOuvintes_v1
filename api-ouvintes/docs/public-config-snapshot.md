# Snapshot de configuração pública no R2

O recurso é opt-in. O comportamento legado continua usando PostgreSQL enquanto
`PUBLIC_CONFIG_READ_MODE=database` (padrão). A publicação automática também
permanece desligada em `PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED=false`. A API
recusa iniciar em modo de leitura R2 se a republicação administrativa estiver
desligada, evitando servir um snapshot que não recebe atualizações.

## Conteúdo e isolamento

O snapshot versionado contém somente campanhas não arquivadas e não draft,
placements publicados e banners ativos com mídia pronta. Não inclui cadastros,
perfis, tokens, telefones, consentimentos, dados administrativos ou campanhas
rascunho. A revisão SHA-256 é calculada sobre o conteúdo, não sobre a hora de
geração, e valida-se novamente durante a leitura.

O objeto é salvo em `public-config/<namespace>/current.json`. O namespace é
configuração fixa do backend, nunca derivada do host ou de parâmetros públicos.
Valores aceitos incluem `development/radio-88`, `test/radio-88`,
`preview/radio-88` e `production/radio-88`. Quando `VERCEL_ENV` está definido,
o prefixo precisa corresponder ao ambiente do deployment.

## Variáveis

Além das credenciais de R2 mantidas exclusivamente no backend:

```dotenv
PUBLIC_CONFIG_READ_MODE=database
PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED=false
PUBLIC_CONFIG_NAMESPACE=preview/radio-88
PUBLIC_CONFIG_R2_TIMEOUT_MS=4000
```

Para usar `PUBLIC_CONFIG_READ_MODE=r2`, também é obrigatório configurar
`PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED=true` e habilitar credenciais R2 do mesmo
ambiente. Não há modo de leitura R2 com escrita administrativa desabilitada.

Não habilite escrita ou leitura no Preview até validar namespace, bucket, URL
pública e fixture compatível com migrations `0001`–`0006`. Não habilite a leitura
em produção até publicar e comparar um snapshot inicial válido.

## Comportamento

- Mutação administrativa concluída é seguida por uma projeção síncrona,
  serializada por advisory transaction lock e limitada por timeout.
- Falha na projeção não desfaz nem repete a mutação original. A API devolve o
  corpo/status legado e sinaliza `X-Public-Config-Sync: pending`; o painel mostra
  uma pendência local e permite `POST /api/admin/public-config/republish`.
- No modo R2, endpoints públicos de configuração não consultam Neon. Snapshot
  ausente, inválido, de namespace diferente ou R2 indisponível resulta em `503`,
  sem fallback SQL.
- `POST /api/public/session/resolve` lê o snapshot primeiro. Sem campanha
  vigente responde neutro sem consultar ou gravar dispositivo; com campanha
  vigente mantém a checagem autoritativa e as gravações legítimas no PostgreSQL.
- Datas de campanha são avaliadas em cada resposta e o `s-maxage` é limitado à
  próxima transição temporal conhecida. Respostas de sessão continuam `no-store`.
- O cache em memória da função dura no máximo 15 segundos. O objeto R2 é lido
  diretamente pelo backend; não se presume cache/invalidação de domínio CDN.

## Banner principal (Plan 050)

A migration `0013_institutional_banner_primary.sql` adiciona o estado editorial.
O leitor aceita `isPrimary` opcional nos banners de `schemaVersion: 1`, sem
preencher valores antes da verificacao SHA-256. Snapshots legados continuam
validos. `INSTITUTIONAL_PRIMARY_BANNER_ENABLED=false` e o padrao: o escritor
omite o campo e a API publica nao expoe destaque ativo.

Para habilitar: aplicar somente a migration nova sobre o schema legado,
publicar primeiro o leitor preparado com a flag falsa, validar o snapshot
atual e os clientes, depois ativar a flag e republicar a configuracao publica.
O painel usa `capabilities.primaryBanner` da listagem administrativa para
habilitar o controle. A publicacao ou edicao ocorre pelas rotas existentes,
com a mesma permissao `institutional_banner.manage`.

Para restaurar o branco, desmarcar o principal. Para voltar a uma API anterior
ao Plan 050, usar primeiro o leitor preparado com a flag falsa e republicar
um snapshot sem o campo novo; so depois retornar ao leitor antigo. Um leitor
antigo pode rejeitar o hash do payload novo. Nao alterar o modo R2 para
reverter apenas essa funcionalidade.

## Rollback completo do mecanismo de snapshot

Primeiro desligue `PUBLIC_CONFIG_READ_MODE` para `database` e publique a API;
depois, quando apropriado, desligue `PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED`. A
mudança de leitura para `database` restaura o caminho legado sem migration. Não
apague snapshots nem objetos de banner como parte do rollback.

Este documento descreve o mecanismo implementado, não autoriza ativá-lo em
Neon, R2 ou Vercel. A habilitação precisa de ambiente isolado e aprovação de
release separada.
