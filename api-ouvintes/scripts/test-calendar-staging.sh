#!/bin/sh
set -eu
G="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
name="radio88-calendar-staging-test-$$"
network="${name}-net"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker network create --internal "$network" >/dev/null
docker run --pull=never -d --name "$name" --network "$network" --network-alias calendar-test -e POSTGRES_USER=fixture -e POSTGRES_PASSWORD=synthetic-password -e POSTGRES_DB=calendar_staging_test postgres:17-alpine >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do docker exec "$name" pg_isready -U fixture -d calendar_staging_test >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network "$network" -e DOTENV_CONFIG_PATH=/dev/null -e NODE_ENV=test -e DATABASE_URL=postgresql://fixture:synthetic-password@calendar-test/calendar_staging_test -e DATABASE_SSL=false -e JWT_SECRET=synthetic-test-secret-at-least-32-characters -e IP_HASH_SECRET=synthetic-ip-hash-secret -e ADMIN_INITIAL_PASSWORD=synthetic-test-password -e CAMPAIGN_STARTS_AT=2026-01-01T00:00:00Z -e RUN_CALENDAR_STAGING_TESTS=true -v "$G/src:/app/src:ro" -v "$G/tests:/app/tests:ro" -v "$G/database:/app/database:ro" -v "$G/vitest.config.ts:/app/vitest.config.ts:ro" -v "$G/tsconfig.json:/app/tsconfig.json:ro" radio88-calendar-parser-test:local sh -c 'npm run db:migrate && npm run db:migrate && npm test -- tests/integration/calendar-poll-staging.test.ts tests/integration/google-calendar-oauth.test.ts tests/integration/calendar-poll-sync.test.ts tests/unit/calendar-poll-parser.test.ts tests/unit/google-calendar-api.test.ts && npm run typecheck && npm run build'
