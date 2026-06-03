#!/usr/bin/env bash
# Foreground launcher. Env-var overrides:
#   HOST=0.0.0.0    bind host       (default 0.0.0.0)
#   PORT=8765       bind port       (default 8765)
#   INTERVAL=1.0    sampling interval, seconds (default 1.0)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
exec python3 app.py \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8765}" \
  --interval "${INTERVAL:-1.0}"
