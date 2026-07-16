#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
TEST_DB="radio88_cadastros_test"
TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-radio88_user}:${POSTGRES_PASSWORD:-radio88_dev_password}@127.0.0.1:5434/${TEST_DB}"

cd "$PROJECT_DIR"

docker compose exec -T postgres psql \
  --username="${POSTGRES_USER:-radio88_user}" \
  --dbname=postgres \
  --tuples-only \
  --command="SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" |
  grep -q 1 ||
  docker compose exec -T postgres createdb \
    --username="${POSTGRES_USER:-radio88_user}" \
    "$TEST_DB"

DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
DATABASE_URL="$TEST_DATABASE_URL" npm run db:seed

printf "Banco de testes pronto: %s\n" "$TEST_DB"
