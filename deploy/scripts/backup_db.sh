#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$DEPLOY_DIR/data"
BACKUP_DIR="$DEPLOY_DIR/backups"

mkdir -p "$DATA_DIR" "$BACKUP_DIR"

DB_FILE="$DATA_DIR/task.db"
STAMP="$(date +%Y%m%d_%H%M%S)"

if [ ! -f "$DB_FILE" ]; then
  echo "[warn] DB file not found: $DB_FILE"
  exit 0
fi

cp "$DB_FILE" "$BACKUP_DIR/task_${STAMP}.db.bak"
echo "[ok] Backup created: $BACKUP_DIR/task_${STAMP}.db.bak"
