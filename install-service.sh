#!/usr/bin/env bash
# Install SystemWebMonitor as a systemd service.
#
# Usage:
#   bash install-service.sh           # interactive sudo (prompts for password)
#   sudo bash install-service.sh      # already-elevated
#
# Environment overrides:
#   PORT=8765        bind port  (default 8765)
#   HOST=0.0.0.0     bind host  (default 0.0.0.0)
#   INTERVAL=1.0     sampling interval seconds (default 1.0)
#   SERVICE_NAME=system-web-monitor

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-system-web-monitor}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Absolute path to the directory this script lives in (project root).
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Pick the user the service should *run as*: if sudoed, that's $SUDO_USER, not root.
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  RUN_USER="$SUDO_USER"
else
  RUN_USER="$(id -un)"
fi
RUN_GROUP="$(id -gn "$RUN_USER")"

PORT="${PORT:-8765}"
HOST="${HOST:-0.0.0.0}"
INTERVAL="${INTERVAL:-1.0}"

# Sanity check.
if [[ ! -x "${SCRIPT_DIR}/start.sh" ]]; then
  echo "Error: ${SCRIPT_DIR}/start.sh not found or not executable" >&2
  exit 1
fi

# Detect whether we need to call sudo for the privileged steps.
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Error: not running as root and 'sudo' is not available" >&2
    exit 1
  fi
  SUDO="sudo"
fi

cat <<EOF
Installing systemd service:
  service:           ${SERVICE_NAME}
  working directory: ${SCRIPT_DIR}
  run as user:       ${RUN_USER} (group ${RUN_GROUP})
  bind:              ${HOST}:${PORT}
  sampling interval: ${INTERVAL}s
EOF

UNIT_TMP=$(mktemp)
trap 'rm -f "$UNIT_TMP"' EXIT

cat > "$UNIT_TMP" <<EOF
[Unit]
Description=System Web Monitor — GPU + CPU dashboard
Documentation=https://github.com/kekedoujia/SystemWebMonitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${SCRIPT_DIR}
Environment=PORT=${PORT}
Environment=HOST=${HOST}
Environment=INTERVAL=${INTERVAL}
ExecStart=${SCRIPT_DIR}/start.sh
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Lightweight hardening — keeps nvidia-smi + RAPL sysfs reads working.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF

$SUDO install -m 0644 -o root -g root "$UNIT_TMP" "$SERVICE_FILE"
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now "$SERVICE_NAME"

echo
echo "Service installed and started. Current status:"
$SUDO systemctl --no-pager status "$SERVICE_NAME" | head -15 || true

cat <<EOF

Common commands:
  sudo systemctl status ${SERVICE_NAME}
  sudo systemctl restart ${SERVICE_NAME}
  sudo systemctl stop ${SERVICE_NAME}
  sudo journalctl -u ${SERVICE_NAME} -f
  sudo bash ${SCRIPT_DIR}/uninstall-service.sh

Open the dashboard at: http://localhost:${PORT}
EOF
