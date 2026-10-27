#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

sh "$SCRIPT_DIR/prepare-legacy-test-db.sh"
cd "$PROJECT_DIR"

export NODE_ENV=test
export DATABASE_URL="postgresql://radio88_user:radio88_hotfix_test_password@127.0.0.1:5436/radio88_primary_banner_test"
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
export RUN_INTEGRATION_TESTS=true
export RUN_LEGACY_SCHEMA_TESTS=true
export INSTITUTIONAL_PRIMARY_BANNER_ENABLED=true
export R2_PUBLIC_BASE_URL=https://media.example.test

npx vitest run --config vitest.legacy.config.ts
