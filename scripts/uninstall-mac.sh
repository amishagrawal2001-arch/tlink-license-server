#!/bin/bash
set -e

# Tlink License Server - macOS Uninstaller
# Run with: sudo bash uninstall-mac.sh

INSTALL_DIR="/usr/local/tlink-license-server"
PLIST_NAME="com.tlink.license-server"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_NAME}.plist"
SYMLINK_PATH="/usr/local/bin/tlink-license-server"

echo "============================================"
echo "  Tlink License Server - macOS Uninstaller"
echo "============================================"
echo ""

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo."
    echo "Usage: sudo bash uninstall-mac.sh"
    exit 1
fi

echo "[1/3] Stopping service..."
if launchctl list "${PLIST_NAME}" &>/dev/null; then
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    echo "  -> Service stopped"
else
    echo "  -> Service not running"
fi

echo "[2/3] Removing LaunchDaemon..."
if [ -f "${PLIST_PATH}" ]; then
    rm -f "${PLIST_PATH}"
    echo "  -> Removed ${PLIST_PATH}"
else
    echo "  -> LaunchDaemon not found, skipping"
fi

echo "[3/3] Removing installation..."
if [ -L "${SYMLINK_PATH}" ]; then
    rm -f "${SYMLINK_PATH}"
    echo "  -> Removed symlink ${SYMLINK_PATH}"
fi

if [ -d "${INSTALL_DIR}" ]; then
    rm -rf "${INSTALL_DIR}"
    echo "  -> Removed ${INSTALL_DIR}"
else
    echo "  -> Installation directory not found, skipping"
fi

echo ""
echo "============================================"
echo "  Uninstallation Complete!"
echo "============================================"
echo ""
echo "  Tlink License Server has been removed."
echo "============================================"
