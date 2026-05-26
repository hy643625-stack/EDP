#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
PID_FILE="$RUN_DIR/pids.env"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
BACKEND_ERR_LOG="$LOG_DIR/backend.error.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
FRONTEND_ERR_LOG="$LOG_DIR/frontend.error.log"

DEFAULT_BACKEND_PORT="${BACKEND_PORT:-18765}"
DEFAULT_FRONTEND_PORT="${FRONTEND_PORT:-5173}"
NO_OPEN_BROWSER="${NO_OPEN_BROWSER:-0}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

# ── helpers ──────────────────────────────────────────────

_local_ip() {
  ifconfig | awk '/inet / && !/127.0.0.1/ {print $2; exit}'
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] Missing command: $1" >&2
    exit 1
  fi
}

port_in_use() {
  lsof -ti ":$1" >/dev/null 2>&1
}

find_available_port() {
  local port="$1"
  local max_tries="${2:-20}"
  for ((i = 0; i <= max_tries; i++)); do
    if ! port_in_use "$((port + i))"; then
      echo "$((port + i))"
      return 0
    fi
  done
  echo "[error] No available port near $port" >&2
  exit 1
}

http_ready() {
  local url="$1"
  local retries="${2:-60}"
  for ((i = 0; i < retries; i++)); do
    if curl --noproxy '*' -s -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

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

preferred_db_path() {
  if [ -n "${TASK_DB_PATH:-}" ]; then
    echo "$TASK_DB_PATH"
    return
  fi
  local app_dir="$HOME/Library/Application Support/EveryDayPerfect"
  mkdir -p "$app_dir"
  local db="$app_dir/task.db"
  if [ ! -f "$db" ]; then
    touch "$db"
  fi
  echo "$db"
}

# ── preflight checks ─────────────────────────────────────

require_cmd "python3"
require_cmd "node"
require_cmd "npm"

NODE_VERSION="$(node -v)"
echo "[info] Node $NODE_VERSION detected"

PY_EXE="$ROOT_DIR/.venv/bin/python"
VITE_JS="$FRONTEND_DIR/node_modules/vite/bin/vite.js"
ESBUILD_CHECK="$FRONTEND_DIR/scripts/check-esbuild-runtime.mjs"

# ── python venv & deps ───────────────────────────────────

if [ ! -x "$PY_EXE" ]; then
  echo "[setup] Creating Python virtual environment..."
  python3 -m venv "$ROOT_DIR/.venv"
fi

if ! "$PY_EXE" -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "[setup] Installing backend dependencies..."
  if ! "$PY_EXE" -m pip install -r "$BACKEND_DIR/requirements.txt" 2>/dev/null; then
    echo "[error] pip install failed (proxy or network issue)." >&2
    echo "Run this in a regular terminal first:" >&2
    echo "  cd \"$ROOT_DIR\" && .venv/bin/pip install -r backend/requirements.txt" >&2
    exit 1
  fi
fi

# ── frontend deps ────────────────────────────────────────

if [ ! -f "$VITE_JS" ]; then
  echo "[setup] Installing frontend dependencies..."
  cd "$FRONTEND_DIR" && npm install
fi

if [ -f "$ESBUILD_CHECK" ]; then
  echo "[check] Verifying frontend esbuild runtime..."
  node "$ESBUILD_CHECK" || { echo "[error] esbuild runtime preflight failed" >&2; exit 1; }
fi

# ── resolve ports ────────────────────────────────────────

TASK_DB_PATH_ACTUAL="$(preferred_db_path)"

backend_port="$DEFAULT_BACKEND_PORT"
backend_bind_url="http://$BIND_HOST:$backend_port"
backend_local_url="http://127.0.0.1:$backend_port"
if port_in_use "$backend_port"; then
  if http_ready "$backend_local_url/health" 1; then
    echo "[backend] Reusing running backend: $backend_local_url"
  else
    stop_by_pidfile "$BACKEND_PID_FILE" "backend"
    backend_port="$(find_available_port "$backend_port")"
    backend_bind_url="http://$BIND_HOST:$backend_port"
    backend_local_url="http://127.0.0.1:$backend_port"
    echo "[backend] Default port busy. Switching to $backend_port"
  fi
fi

frontend_port="$DEFAULT_FRONTEND_PORT"
frontend_bind_url="http://$BIND_HOST:$frontend_port"
frontend_local_url="http://127.0.0.1:$frontend_port"
if port_in_use "$frontend_port"; then
  if http_ready "$frontend_local_url" 1; then
    echo "[frontend] Reusing running frontend: $frontend_local_url"
  else
    stop_by_pidfile "$FRONTEND_PID_FILE" "frontend"
    frontend_port="$(find_available_port "$frontend_port")"
    frontend_bind_url="http://$BIND_HOST:$frontend_port"
    frontend_local_url="http://127.0.0.1:$frontend_port"
    echo "[frontend] Default port busy. Switching to $frontend_port"
  fi
fi

CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:$frontend_port,http://localhost:$frontend_port}"

# When binding to all interfaces, point frontend at the LAN IP for mobile access
if [ "$BIND_HOST" != "127.0.0.1" ]; then
  LAN_IP="$(_local_ip)"
  FRONTEND_API_URL="http://$LAN_IP:$backend_port"
  CORS_ORIGINS="$CORS_ORIGINS,http://$LAN_IP:$frontend_port"
else
  FRONTEND_API_URL="$backend_local_url"
fi

# ── start backend ────────────────────────────────────────

if ! http_ready "$backend_local_url/health" 1; then
  echo "[backend] Starting..."
  :> "$BACKEND_LOG"
  :> "$BACKEND_ERR_LOG"

  TASK_DB_PATH="$TASK_DB_PATH_ACTUAL" \
  CORS_ORIGINS="$CORS_ORIGINS" \
    "$PY_EXE" -m uvicorn app.main:app \
      --app-dir "$BACKEND_DIR" \
      --host "$BIND_HOST" \
      --port "$backend_port" \
      >"$BACKEND_LOG" 2>"$BACKEND_ERR_LOG" &
  echo $! > "$BACKEND_PID_FILE"
fi

echo "[wait] Waiting for backend..."
if ! http_ready "$backend_local_url/health" 60; then
  echo "[error] Backend failed to start. Check $BACKEND_LOG and $BACKEND_ERR_LOG" >&2
  exit 1
fi

# ── start frontend ───────────────────────────────────────

if ! http_ready "$frontend_local_url" 1; then
  echo "[frontend] Starting..."
  :> "$FRONTEND_LOG"
  :> "$FRONTEND_ERR_LOG"

  (
    cd "$FRONTEND_DIR"
    VITE_API_BASE_URL="$FRONTEND_API_URL" \
      node "$VITE_JS" --host "$BIND_HOST" --port "$frontend_port" \
        >"$FRONTEND_LOG" 2>"$FRONTEND_ERR_LOG" &
    echo $! > "$FRONTEND_PID_FILE"
  )
fi

echo "[wait] Waiting for frontend..."
if ! http_ready "$frontend_local_url" 60; then
  echo "[error] Frontend failed to start. Check $FRONTEND_LOG and $FRONTEND_ERR_LOG" >&2
  exit 1
fi

# ── write run info ───────────────────────────────────────

cat > "$PID_FILE" <<EOF
ROOT_DIR=$ROOT_DIR
BACKEND_PORT=$backend_port
FRONTEND_PORT=$frontend_port
BACKEND_URL=$backend_local_url
FRONTEND_URL=$frontend_local_url
TASK_DB_PATH=$TASK_DB_PATH_ACTUAL
EOF

if [ -f "$BACKEND_PID_FILE" ]; then
  echo "BACKEND_PID=$(cat "$BACKEND_PID_FILE")" >> "$PID_FILE"
fi
if [ -f "$FRONTEND_PID_FILE" ]; then
  echo "FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")" >> "$PID_FILE"
fi

echo "[ok] Services are ready"
echo "      Frontend : $frontend_local_url"
echo "      Backend  : $backend_local_url"
if [ "$BIND_HOST" != "127.0.0.1" ]; then
  echo "      Network  : http://$LAN_IP:$frontend_port (mobile / LAN)"
fi
echo "      DB Path  : $TASK_DB_PATH_ACTUAL"
echo "      Logs     : $LOG_DIR"

if [ "$NO_OPEN_BROWSER" != "1" ]; then
  open "$frontend_local_url" 2>/dev/null || true
fi
