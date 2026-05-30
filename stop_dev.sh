#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PORT="${BACKEND_PORT:-18765}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

kill_port() {
  local port="$1"
  local name="$2"
  local pids
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    echo "[$name] no process on port $port"
    return
  fi
  for pid in $pids; do
    if kill "$pid" 2>/dev/null; then
      echo "[$name] TERM sent to pid=$pid (port $port)"
    fi
  done
  # Wait up to 3s for graceful shutdown
  for _ in $(seq 1 6); do
    pids="$(lsof -ti ":$port" 2>/dev/null || true)"
    if [ -z "$pids" ]; then
      echo "[$name] stopped"
      return
    fi
    sleep 0.5
  done
  # Force kill remaining
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
    echo "[$name] KILL sent to pid=$pid (port $port)"
  done
  sleep 0.5
  echo "[$name] force stopped"
}

kill_port "$BACKEND_PORT" "backend"
kill_port "$FRONTEND_PORT" "frontend"

rm -f "$RUN_DIR/backend.pid" "$RUN_DIR/frontend.pid" "$RUN_DIR/pids.env"
echo "[ok] stop completed"
