#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker command not found. Please install Docker first."
  exit 127
fi

mkdir -p "$DEPLOY_DIR/data"

cd "$DEPLOY_DIR"
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE=".env.example"
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.yml up -d --build

echo "[ok] Deploy finished."
echo "     Web: http://127.0.0.1:${WEB_PORT:-8080}"
