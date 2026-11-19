#!/bin/sh
# Disposable PostgreSQL only; no .env, existing Docker service or persistent volume is used.
set -eu
cd "$(dirname "$0")/.."
name="radio88-participation-test-$$"
started=false
cleanup() { if [ "$started" = true ]; then docker rm -f "$name" >/dev/null; fi; }
trap cleanup EXIT INT TERM

docker run --pull=never -d --name "$name" -e POSTGRES_USER=participation_test \
  -e POSTGRES_PASSWORD=synthetic_test_password -e POSTGRES_DB=participation_admin_test \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
started=true
ready=false
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$name" pg_isready -U participation_test -d participation_admin_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo 'Disposable PostgreSQL did not become ready' >&2; exit 1; }
port=$(docker port "$name" 5432/tcp | sed 's/.*://')
export DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test DATABASE_SSL=false
export DATABASE_URL="postgresql://participation_test:synthetic_test_password@127.0.0.1:${port}/participation_admin_test"
export JWT_SECRET=synthetic-test-secret-at-least-32-characters IP_HASH_SECRET=synthetic-ip-hash-secret
export ADMIN_INITIAL_PASSWORD=synthetic-test-password CAMPAIGN_STARTS_AT=2026-01-01T00:00:00Z
export POLLS_ENABLED=true PROGRAMMING_ENABLED=false PROGRAMMING_PUBLICATION_ENABLED=false
export MEDIA_STORAGE_DRIVER=disabled PUBLIC_CONFIG_READ_MODE=database FEED_ENABLED=false FEED_PUBLICATION_ENABLED=false
unset R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_PUBLIC_BASE_URL
npm run db:migrate
npm run db:migrate
RUN_PARTICIPATION_TESTS=true npm test -- --configLoader runner tests/unit/participation-admin.test.ts tests/integration/participation-admin.test.ts
