#!/bin/sh
# Disposable PostgreSQL only; no .env, existing Docker service or persistent volume is used.
set -eu
cd "$(dirname "$0")/.."
name="radio88-public_poll-test-$$"
started=false
snapshot_dir=$(mktemp -d /tmp/radio88-public-poll-test.XXXXXX)
cleanup() { rm -f "$snapshot_dir/polls.json"; rmdir "$snapshot_dir"; if [ "$started" = true ]; then docker rm -f "$name" >/dev/null; fi; }
trap cleanup EXIT INT TERM

docker run --pull=never -d --name "$name" -e POSTGRES_USER=public_poll_test \
  -e POSTGRES_PASSWORD=synthetic_test_password -e POSTGRES_DB=public_poll_admin_test \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
started=true
ready=false
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$name" pg_isready -U public_poll_test -d public_poll_admin_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo 'Disposable PostgreSQL did not become ready' >&2; exit 1; }
port=$(docker port "$name" 5432/tcp | sed 's/.*://')
export DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test DATABASE_SSL=false
export DATABASE_URL="postgresql://public_poll_test:synthetic_test_password@127.0.0.1:${port}/public_poll_admin_test"
export JWT_SECRET=synthetic-test-secret-at-least-32-characters IP_HASH_SECRET=synthetic-ip-hash-secret
export ADMIN_INITIAL_PASSWORD=synthetic-test-password CAMPAIGN_STARTS_AT=2026-01-01T00:00:00Z
export POLLS_PUBLIC_LOCAL_ENABLED=true
export POLLS_PUBLIC_LOCAL_SNAPSHOT_FILE="$snapshot_dir/polls.json"
export DEVICE_TOKEN_SECRET=synthetic-device-token-secret-at-least-32-characters
unset VERCEL_ENV
export POLLS_ENABLED=true PROGRAMMING_ENABLED=false PROGRAMMING_PUBLICATION_ENABLED=false
export MEDIA_STORAGE_DRIVER=disabled PUBLIC_CONFIG_READ_MODE=database FEED_ENABLED=false FEED_PUBLICATION_ENABLED=false
unset R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_PUBLIC_BASE_URL
npm run db:migrate
npm run db:migrate
RUN_PUBLIC_POLL_TESTS=true npm test -- --configLoader runner tests/unit/public-poll.test.ts tests/unit/public-poll-runtime.test.ts tests/integration/public-poll.test.ts
