#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
EXPECTED_URL="postgresql://radio88_user:radio88_hotfix_test_password@127.0.0.1:5436/radio88_primary_banner_test"
DATABASE_URL=${LEGACY_TEST_DATABASE_URL:-$EXPECTED_URL}
EXPECTED_MIGRATIONS=$(printf '%s\n' \
  0001_initial_schema.sql \
  0002_campaign_platform_identity_rbac.sql \
  0003_institutional_banners_r2.sql \
  0004_institutional_banner_action_type.sql \
  0005_listener_registration_campaign_phone_unique.sql \
  0006_sweepstake_draws.sql \
  0013_institutional_banner_primary.sql)

if [ "$DATABASE_URL" != "$EXPECTED_URL" ]; then
  echo "LEGACY_TEST_DATABASE_URL deve apontar exatamente para o Postgres local descartavel na porta 5436." >&2
  exit 1
fi

ACTUAL_MIGRATIONS=$(find "$PROJECT_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort)
if [ "$ACTUAL_MIGRATIONS" != "$EXPECTED_MIGRATIONS" ]; then
  echo "A allowlist de migrations deste teste mudou. Revisao manual obrigatoria." >&2
  exit 1
fi

cd "$PROJECT_DIR"
docker compose -f compose.legacy-test.yaml up -d --wait postgres

export NODE_ENV=test
export DATABASE_URL
export DATABASE_SSL=false
export DATABASE_POOL_MAX=2
export JWT_SECRET=radio88-hotfix-legacy-test-jwt-secret
export IP_HASH_SECRET=radio88-hotfix-legacy-test-ip-hash-secret
export DEVICE_TOKEN_SECRET=radio88-hotfix-legacy-test-device-token-secret
export ADMIN_INITIAL_NAME="Administrador de teste"
export ADMIN_INITIAL_USERNAME=admin
export ADMIN_INITIAL_PASSWORD=development-admin-password
export CAMPAIGN_STARTS_AT=2026-01-01T00:00:00Z
export CAMPAIGN_ENDS_AT=2026-12-31T23:59:59Z

npm run db:migrate
npm run db:seed

# Production legacy databases have the initial admin linked by migration 0006.
# Recreate that association in this fresh disposable database after seeding.
docker compose -f compose.legacy-test.yaml exec -T postgres psql \
  -U radio88_user -d radio88_primary_banner_test -v ON_ERROR_STOP=1 \
  -c "INSERT INTO admin_user_role (admin_user_id, role_id)
      SELECT au.id, r.id
      FROM admin_user au
      JOIN role r ON r.key = au.role
      WHERE au.username = 'admin'
      ON CONFLICT DO NOTHING"

APPLIED_MIGRATIONS=$(docker compose -f compose.legacy-test.yaml exec -T postgres \
  psql -U radio88_user -d radio88_primary_banner_test -Atc \
  "SELECT string_agg(id, E'\\n' ORDER BY id) FROM schema_migration")
if [ "$APPLIED_MIGRATIONS" != "$EXPECTED_MIGRATIONS" ]; then
  echo "O banco descartavel nao esta nas migrations 0001-0006 mais 0013." >&2
  exit 1
fi

echo "Banco descartavel pronto: radio88_primary_banner_test (migrations 0001-0006 mais 0013)."
