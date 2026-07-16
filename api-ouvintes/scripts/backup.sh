#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
OUTPUT="${BACKUP_DIR}/radio88-cadastros-${TIMESTAMP}.dump"

cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump \
  --username="${POSTGRES_USER:-radio88_user}" \
  --dbname="${POSTGRES_DB:-radio88_cadastros}" \
  --format=custom \
  --no-owner \
  --no-privileges > "$OUTPUT"

chmod 600 "$OUTPUT"
printf "Backup criado em %s\n" "$OUTPUT"
