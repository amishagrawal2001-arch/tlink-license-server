#!/bin/bash
set -e

# Tlink License Server - Linux Installer
# Run with: sudo bash install-linux.sh
# Idempotent: safe to run multiple times

INSTALL_DIR="/opt/tlink-license-server"
BINARY_NAME="tlink-license-server-linux"
SERVICE_NAME="tlink-license-server"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
PORT=4000

echo "============================================"
echo "  Tlink License Server - Linux Installer"
echo "============================================"
echo ""

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo."
    echo "Usage: sudo bash install-linux.sh"
    exit 1
fi

# Determine script directory
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

echo "[3/7] Creating dedicated service user..."
if ! id -u tlink-license &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin tlink-license
    echo "  -> Created user: tlink-license"
else
    echo "  -> User tlink-license already exists"
fi

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

# Set ownership
chown -R tlink-license:tlink-license "${INSTALL_DIR}"

echo "[5/7] Seeding database..."
cd "${INSTALL_DIR}"
sudo -u tlink-license ./tlink-license-server --seed 2>/dev/null || echo "  -> Seed skipped (may already be seeded or seed flag not supported)"

echo "[6/7] Creating systemd service..."
# Stop existing service if running
if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    systemctl stop "${SERVICE_NAME}"
fi

cat > "${SERVICE_PATH}" <<SERVICEEOF
[Unit]
Description=Tlink License Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=tlink-license
Group=tlink-license
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/tlink-license-server
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/.env
StandardOutput=append:${INSTALL_DIR}/data/stdout.log
StandardError=append:${INSTALL_DIR}/data/stderr.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}/data
ProtectHome=true

[Install]
WantedBy=multi-user.target
SERVICEEOF

chmod 644 "${SERVICE_PATH}"

echo "[7/7] Enabling and starting service..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"

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
echo "    sudo systemctl status ${SERVICE_NAME}"
echo "    sudo systemctl stop ${SERVICE_NAME}"
echo "    sudo systemctl start ${SERVICE_NAME}"
echo "    sudo systemctl restart ${SERVICE_NAME}"
echo "    sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "  To uninstall: sudo bash scripts/uninstall-linux.sh"
echo "============================================"
