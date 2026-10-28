#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for file in .env.feed-preview.compose .env.feed-preview.local .env.feed-preview.postgres .env.feed-preview.site; do
  if [[ ! -f "$file" ]]; then
    echo "Arquivo local ausente: $file" >&2
    exit 1
  fi
done

docker compose \
  --env-file .env.feed-preview.compose \
  -f compose.feed-preview.yaml \
  up -d --build --wait

echo "Feed Preview local pronto: http://127.0.0.1:5181"
echo "Institucional local: http://127.0.0.1:8086/feed"
echo "API local: http://127.0.0.1:3012/health"
