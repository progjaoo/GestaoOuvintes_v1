# Operação, Banco e Deploy

## Banco

Banco principal:

```text
radio88_cadastros
```

Banco reservado aos testes:

```text
radio88_cadastros_test
```

Nunca execute os testes de integração apontando para o banco principal. A suíte
recusa URLs que não contenham `_test`.

## Migrações

As migrações ficam em `database/migrations` e são aplicadas em ordem alfabética.
Cada arquivo aplicado é registrado em `schema_migration`.

O runner:

- cria `schema_migration` se necessário;
- executa cada arquivo em transação;
- não reaplica arquivos registrados;
- interrompe o startup se uma migração falhar.

Não altere uma migração já publicada. Crie a próxima:

```text
0002_descricao_da_mudanca.sql
```

## Produção

Antes de publicar:

1. Trocar todos os segredos do `.env`.
2. Usar HTTPS no proxy reverso.
3. Não publicar a porta `5432` do PostgreSQL.
4. Configurar somente os domínios reais em `CORS_ALLOWED_ORIGINS`.
5. Usar usuário PostgreSQL exclusivo.
6. Configurar backup externo à VPS.
7. Testar restauração.
8. Trocar a senha administrativa inicial.
9. Revisar aviso de privacidade e retenção com a empresa.

No Compose de produção, remova a seção `ports` do serviço `postgres`. A API se
conecta pelo hostname interno `postgres`.

## Backup

```bash
./scripts/backup.sh
```

O arquivo:

- usa formato custom do `pg_dump`;
- não contém owner/privileges;
- recebe permissão local `600`;
- fica em `backups/`, ignorado pelo Git.

Copie o backup criptografado para fora da VPS.

## Teste de restauração

```bash
./scripts/restore-test.sh backups/radio88-cadastros-AAAAMMDD-HHMMSS.dump
```

O script recria `radio88_cadastros_restore_test`, restaura e valida contagens.

## Healthcheck

- `/health`: processo.
- `/ready`: processo e banco.

O proxy/orquestrador deve remover a instância de rotação quando `/ready` falhar.

## Logs

Não registrar:

- nome;
- telefone;
- senha;
- token JWT;
- corpo de exportação.

Os logs atuais redigem esses campos e registram apenas metadados técnicos.

## Retenção

O código suporta exclusão lógica via `deleted_at`, mas nenhuma rotina automática
de retenção foi ativada porque o prazo precisa de decisão empresarial/jurídica.
Essa decisão deve ser tomada antes do lançamento.

## Rollback

Migrações de produção são forward-only. Para rollback operacional:

1. interromper escrita;
2. restaurar backup validado em banco novo;
3. apontar `DATABASE_URL` para o banco restaurado;
4. executar `/ready`;
5. reabrir tráfego.

Não use `DROP TABLE` automático em produção.
