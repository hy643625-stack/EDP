#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/pids.env"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

stop_by_pidfile() {
  local file="$1"
  local name="$2"
  if [ ! -f "$file" ]; then return; fi
  local pid
  pid="$(head -1 "$file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "[$name] stopped pid=$pid"
  fi
  rm -f "$file"
}

stop_by_pidfile "$BACKEND_PID_FILE" "backend"
stop_by_pidfile "$FRONTEND_PID_FILE" "frontend"
rm -f "$PID_FILE"

echo "[ok] stop completed"
