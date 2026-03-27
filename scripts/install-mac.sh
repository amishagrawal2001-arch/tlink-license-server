#!/bin/bash
set -e

# Tlink License Server - macOS Installer
# Run with: sudo bash install-mac.sh
# Idempotent: safe to run multiple times

INSTALL_DIR="/usr/local/tlink-license-server"
BINARY_NAME="tlink-license-server-macos"
PLIST_NAME="com.tlink.license-server"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_NAME}.plist"
SYMLINK_PATH="/usr/local/bin/tlink-license-server"
PORT=4000

echo "============================================"
echo "  Tlink License Server - macOS Installer"
echo "============================================"
echo ""

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo."
    echo "Usage: sudo bash install-mac.sh"
    exit 1
fi

# Determine script directory (where the archive was extracted)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find the executable
EXECUTABLE=""
if [ -f "${SCRIPT_DIR}/${BINARY_NAME}" ]; then
    EXECUTABLE="${SCRIPT_DIR}/${BINARY_NAME}"
elif [ -f "${SCRIPT_DIR}/tlink-license-server" ]; then
    EXECUTABLE="${SCRIPT_DIR}/tlink-license-server"
else
    echo "ERROR: Cannot find the tlink-license-server executable."
    echo "Make sure the executable is in the same directory as this script."
    exit 1
fi

echo "[1/7] Creating installation directory..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/data"

echo "[2/7] Copying executable..."
cp "${EXECUTABLE}" "${INSTALL_DIR}/tlink-license-server"
chmod +x "${INSTALL_DIR}/tlink-license-server"

# Copy static assets if present
if [ -d "${SCRIPT_DIR}/admin" ]; then
    cp -R "${SCRIPT_DIR}/admin" "${INSTALL_DIR}/"
fi
if [ -d "${SCRIPT_DIR}/docs" ]; then
    cp -R "${SCRIPT_DIR}/docs" "${INSTALL_DIR}/"
fi

echo "[3/7] Creating symlink..."
ln -sf "${INSTALL_DIR}/tlink-license-server" "${SYMLINK_PATH}"

echo "[4/7] Creating default configuration..."
if [ ! -f "${INSTALL_DIR}/.env" ]; then
    if [ -f "${SCRIPT_DIR}/.env.example" ]; then
        cp "${SCRIPT_DIR}/.env.example" "${INSTALL_DIR}/.env"
    else
        cat > "${INSTALL_DIR}/.env" <<'ENVEOF'
PORT=4000
JWT_SECRET=change-me-to-a-random-string
KEY_SALT=change-me-to-another-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
CORS_ORIGINS=http://localhost:*
DATABASE_PATH=./data/licenses.db
ENVEOF
    fi
    echo "  -> Created default .env (edit ${INSTALL_DIR}/.env to configure)"
else
    echo "  -> .env already exists, skipping"
fi

echo "[5/7] Seeding database..."
cd "${INSTALL_DIR}"
./tlink-license-server --seed 2>/dev/null || echo "  -> Seed skipped (may already be seeded or seed flag not supported)"

echo "[6/7] Creating LaunchDaemon for auto-start..."
# Stop existing service if running
if launchctl list "${PLIST_NAME}" &>/dev/null; then
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
fi

cat > "${PLIST_PATH}" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/tlink-license-server</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/data/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/data/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
PLISTEOF

chmod 644 "${PLIST_PATH}"

echo "[7/7] Starting service..."
launchctl load "${PLIST_PATH}"

echo ""
echo "============================================"
echo "  Installation Complete!"
echo "============================================"
echo ""
echo "  Server URL:     http://localhost:${PORT}"
echo "  Admin Dashboard: http://localhost:${PORT}/admin"
echo "  API Docs:       http://localhost:${PORT}/docs"
echo ""
echo "  Install path:   ${INSTALL_DIR}"
echo "  Config file:    ${INSTALL_DIR}/.env"
echo "  Logs:           ${INSTALL_DIR}/data/stdout.log"
echo ""
echo "  Service commands:"
echo "    sudo launchctl stop ${PLIST_NAME}"
echo "    sudo launchctl start ${PLIST_NAME}"
echo ""
echo "  To uninstall: sudo bash scripts/uninstall-mac.sh"
echo "============================================"
