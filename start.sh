#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
exec python3 app.py --host 0.0.0.0 --port "${PORT:-8765}"
