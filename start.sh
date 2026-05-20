#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
exec python3 app.py \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8765}" \
  --interval "${INTERVAL:-1.0}"
