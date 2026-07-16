#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  printf "Uso: %s backups/arquivo.dump\n" "$0" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
BACKUP_FILE=$1
RESTORE_DB="radio88_cadastros_restore_test"

cd "$PROJECT_DIR"

if [ ! -f "$BACKUP_FILE" ]; then
  printf "Arquivo de backup nao encontrado: %s\n" "$BACKUP_FILE" >&2
  exit 1
fi

docker compose exec -T postgres dropdb \
  --username="${POSTGRES_USER:-radio88_user}" \
  --if-exists \
  "$RESTORE_DB"

docker compose exec -T postgres createdb \
  --username="${POSTGRES_USER:-radio88_user}" \
  "$RESTORE_DB"

docker compose exec -T postgres pg_restore \
  --username="${POSTGRES_USER:-radio88_user}" \
  --dbname="$RESTORE_DB" \
  --no-owner \
  --no-privileges < "$BACKUP_FILE"

docker compose exec -T postgres psql \
  --username="${POSTGRES_USER:-radio88_user}" \
  --dbname="$RESTORE_DB" \
  --command="SELECT count(*) AS campaigns FROM campaign;" \
  --command="SELECT count(*) AS registrations FROM listener_registration;" \
  --command="SELECT count(*) AS export_audits FROM registration_export_audit;"

printf "Restauracao validada no banco temporario %s\n" "$RESTORE_DB"
