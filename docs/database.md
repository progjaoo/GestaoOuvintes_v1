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
