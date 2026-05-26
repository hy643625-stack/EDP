#!/usr/bin/env bash
set -euo pipefail
BIND_HOST=0.0.0.0 exec "$(dirname "$0")/start_dev.sh"
