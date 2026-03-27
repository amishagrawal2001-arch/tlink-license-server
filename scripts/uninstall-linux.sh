#!/bin/bash
set -e

# Tlink License Server - Linux Uninstaller
# Run with: sudo bash uninstall-linux.sh

INSTALL_DIR="/opt/tlink-license-server"
SERVICE_NAME="tlink-license-server"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

echo "============================================"
echo "  Tlink License Server - Linux Uninstaller"
echo "============================================"
echo ""

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo."
    echo "Usage: sudo bash uninstall-linux.sh"
    exit 1
fi

echo "[1/3] Stopping and disabling service..."
if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    systemctl stop "${SERVICE_NAME}"
    echo "  -> Service stopped"
else
    echo "  -> Service not running"
fi

if systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
    systemctl disable "${SERVICE_NAME}"
    echo "  -> Service disabled"
fi

echo "[2/3] Removing service file..."
if [ -f "${SERVICE_PATH}" ]; then
    rm -f "${SERVICE_PATH}"
    systemctl daemon-reload
    echo "  -> Removed ${SERVICE_PATH}"
else
    echo "  -> Service file not found, skipping"
fi

echo "[3/3] Removing installation..."
if [ -d "${INSTALL_DIR}" ]; then
    rm -rf "${INSTALL_DIR}"
    echo "  -> Removed ${INSTALL_DIR}"
else
    echo "  -> Installation directory not found, skipping"
fi

# Remove service user (optional, non-fatal)
if id -u tlink-license &>/dev/null; then
    userdel tlink-license 2>/dev/null || true
    echo "  -> Removed user: tlink-license"
fi

echo ""
echo "============================================"
echo "  Uninstallation Complete!"
echo "============================================"
echo ""
echo "  Tlink License Server has been removed."
echo "============================================"
