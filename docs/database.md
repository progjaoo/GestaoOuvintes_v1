# Banco de dados

Banco: PostgreSQL 16.

ORM: Drizzle ORM.

Projeto responsavel: `api-ouvintes`.

## Bancos

Principal:

```text
radio88_cadastros
```

Testes de integracao:

```text
radio88_cadastros_test
```

## Tabelas

- `campaign`: campanhas de cadastro.
- `admin_user`: usuarios administrativos.
- `listener_registration`: cadastros de ouvintes.
- `registration_export_audit`: auditoria de exportacoes.
- `schema_migration`: controle interno das migracoes aplicadas.

## Migracoes

As migracoes ficam em:

```text
api-ouvintes/database/migrations/
```

Padrao de nome:

```text
0002_descricao_da_mudanca.sql
```

Regras:

- Nao altere uma migracao ja publicada.
- Crie sempre uma nova migracao para mudancas de schema.
- Migre antes de subir a API.
- Testes de integracao nunca devem apontar para o banco principal.

## Seed

O seed cria:

- campanha inicial;
- usuario administrativo inicial, se ainda nao existir.

Variaveis relevantes:

```env
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=<senha-forte>
```

Alterar a senha no `.env` depois que o usuario ja existe nao troca o hash salvo no banco.

## Backup e restore

Scripts:

```bash
./scripts/backup.sh
./scripts/restore-test.sh backups/<arquivo>.dump
```

Backups devem ser copiados para fora da VPS, preferencialmente criptografados.

## Banner principal institucional (Plan 050)

Migration aditiva: `0013_institutional_banner_primary.sql`. A numeracao evita
colisao com `0007` a `0012` da linha ainda nao publicada de Clerk/tenancy.
Esta entrega usa apenas `0001` a `0006` mais `0013`; nao executar migrations
daquela linha para habilitar o destaque.

`institutional_banner.is_primary` inicia falso. Um indice parcial unico por
`placement_key` garante um unico destaque; o check exige banner ativo, nao
excluido e no placement `home_hero`. A API serializa as mutacoes editoriais e
registra a troca em `admin_audit_log`. A futura integracao com tenancy deve
reconciliar o indice para incluir o tenant.

Teste descartavel: `npm run test:compat:legacy`, PostgreSQL 17 no compose
`radio88-plan050-legacy`, porta `127.0.0.1:5436`, banco
`radio88_primary_banner_test`. Os scripts recusam outro destino e verificam
a allowlist exata de migrations. Nenhum teste destrutivo usa o Neon.

## Sorteios auditaveis

As migracoes de sorteio foram introduzidas em `0006_sweepstake_draws.sql`.

- `sweepstake_draw`: resultado, sequencia, algoritmo, hash do universo elegivel, executor e encadeamento de ressorteios.
- `sweepstake_draw_entry`: snapshot imutavel das participacoes consideradas em cada apuracao.
- somente um resultado pode permanecer com status `selected` por campanha; resultados anteriores ficam `superseded`.
- permissoes `sweepstake.read`, `sweepstake.draw` e `sweepstake.redraw` sao concedidas ao papel `admin`.

Antes de uma apuracao, confira participacoes legadas:

```bash
cd api-ouvintes
npm run participants:backfill
# Depois de revisar as contagens:
npm run participants:backfill -- --apply
# Opcional: limitar a uma campanha
npm run participants:backfill -- --campaign=<uuid>
```

O comando e idempotente, nao imprime PII e executa a aplicacao dentro de transacao.
