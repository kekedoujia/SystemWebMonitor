#!/usr/bin/env bash
# One-click install for SystemWebMonitor.
#
# This project is pure Python stdlib + nvidia-smi, so "install" just means:
#   - verify python3 is present and recent enough
#   - mark the launcher scripts executable
#   - create runtime directories
#
# Usage:
#   bash install.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "[install] checking python3 ..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 not found in PATH" >&2
  exit 1
fi

PY_VER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
PY_OK="$(python3 -c 'import sys; print(sys.version_info >= (3, 8))')"
if [[ "$PY_OK" != "True" ]]; then
  echo "Error: need Python 3.8+, found $PY_VER" >&2
  exit 1
fi
echo "[install]   python3 $PY_VER"

echo "[install] checking nvidia-smi (optional) ..."
if command -v nvidia-smi >/dev/null 2>&1; then
  echo "[install]   nvidia-smi present"
else
  echo "[install]   nvidia-smi NOT found — GPU panels will be empty"
fi

echo "[install] marking scripts executable ..."
chmod +x start.sh install-service.sh uninstall-service.sh 2>/dev/null || true

cat <<EOF

Install complete.

Quick start:
  ./start.sh                    # foreground, default 0.0.0.0:8765
  PORT=9000 ./start.sh          # custom port

Run on boot as a systemd service:
  bash install-service.sh       # uses sudo to install + start the unit
  PORT=9000 bash install-service.sh

Open the dashboard at: http://<host>:8765
EOF
