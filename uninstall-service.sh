#!/usr/bin/env bash
# Remove the SystemWebMonitor systemd unit installed by install-service.sh.
#
# Usage:
#   bash uninstall-service.sh         # interactive sudo
#   sudo bash uninstall-service.sh

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-system-web-monitor}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

$SUDO systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
$SUDO rm -f "$SERVICE_FILE"
$SUDO systemctl daemon-reload
$SUDO systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true

echo "Service ${SERVICE_NAME} uninstalled."
