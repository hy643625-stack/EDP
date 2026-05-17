#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker command not found. Please install Docker first."
  exit 127
fi

cd "$DEPLOY_DIR"
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE=".env.example"
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.yml down

echo "[ok] Services stopped."
