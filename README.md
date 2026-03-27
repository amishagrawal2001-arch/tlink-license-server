# Tlink License Server

Centralized license management server for all Tlink products.

**[Full Documentation](https://amishagrawal2001-arch.github.io/tlink-license-server/)** | [Admin Dashboard](http://localhost:4000/admin) | [API Health](http://localhost:4000/api/health)

## Quick Start

```bash
npm install
npm run seed    # Create admin user + sample keys
npm start       # Start on http://localhost:4000
```

**Admin Dashboard:** http://localhost:4000/admin
- Username: `admin`
- Password: `admin123`

## API Endpoints

### Public (Client Apps)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/license/activate` | Activate a license key |
| POST | `/api/license/validate` | Check if key is valid |
| POST | `/api/license/deactivate` | Deactivate from machine |
| POST | `/api/license/heartbeat` | Lightweight ping |

### Admin (JWT Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Get JWT token |
| GET | `/api/keys` | List all keys (filterable) |
| POST | `/api/keys` | Generate new key |
| GET | `/api/keys/:id` | Key details + activations |
| PUT | `/api/keys/:id` | Update key |
| DELETE | `/api/keys/:id` | Revoke key |
| GET | `/api/dashboard/stats` | Overview statistics |
| GET | `/api/dashboard/recent` | Recent activity |

## Environment Variables

Copy `.env.example` to `.env` and configure:
- `JWT_SECRET` — Random string for JWT signing
- `KEY_SALT` — Random string for key checksum
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Initial admin credentials

## Registering New Apps

```bash
curl -X POST http://localhost:4000/api/keys/apps/register \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"appCode":"TM","appName":"Tlink Monitor"}'
```

## Key Format

`TLINK-[APP]-[TIER][RANDOM]-[YYMM]-[RANDOM]-[CHECKSUM]`

## Installation (Standalone Binary)

Pre-built binaries are available on the [GitHub Releases](../../releases) page. No Node.js installation required.

### macOS

```bash
# Download the archive for your architecture (arm64 or x64)
tar -xzf tlink-license-server-macos-arm64.tar.gz
cd tlink-license-server-macos-arm64

# Install (creates service, starts automatically on boot)
sudo bash install-mac.sh
```

The server will be available at `http://localhost:4000` with the admin dashboard at `http://localhost:4000/admin`.

**Service commands:**
```bash
sudo launchctl stop com.tlink.license-server
sudo launchctl start com.tlink.license-server
```

### Linux

```bash
# Download and extract
tar -xzf tlink-license-server-linux-x64.tar.gz
cd tlink-license-server-linux-x64

# Install (creates systemd service, starts automatically on boot)
sudo bash install-linux.sh
```

**Service commands:**
```bash
sudo systemctl status tlink-license-server
sudo systemctl restart tlink-license-server
sudo journalctl -u tlink-license-server -f
```

### Windows

1. Download `tlink-license-server-windows-x64.zip`
2. Extract the archive
3. Right-click `install-win.bat` and select **Run as administrator**

**Service commands (run as Administrator):**
```
sc stop TlinkLicenseServer
sc start TlinkLicenseServer
sc query TlinkLicenseServer
```

### Configuration

After installation, edit the `.env` file in the installation directory:
- **macOS:** `/usr/local/tlink-license-server/.env`
- **Linux:** `/opt/tlink-license-server/.env`
- **Windows:** `C:\Program Files\Tlink License Server\.env`

### Uninstall

```bash
# macOS
sudo bash /usr/local/tlink-license-server/scripts/uninstall-mac.sh

# Linux
sudo bash /opt/tlink-license-server/scripts/uninstall-linux.sh

# Windows — run uninstall-win.bat as Administrator
```

## Building from Source

To build standalone executables from source:

```bash
npm install
npm run package:all    # Builds for macOS, Windows, and Linux
```

Individual platform builds:
```bash
npm run package:mac     # macOS (ARM64 + x64)
npm run package:win     # Windows x64
npm run package:linux   # Linux x64
```

Executables are output to the `dist/` directory.

## Documentation

Full API documentation, client integration guides, and deployment instructions are available at:

**https://amishagrawal2001-arch.github.io/tlink-license-server/**

The documentation covers:
- Getting Started & How It Works
- API Reference (Public & Admin endpoints)
- Client Integration Guide (TypeScript/JavaScript)
- License Key Format & Validation
- Installation Guide (macOS, Linux, Windows, Docker)
- Admin Workflow & Dashboard Usage
- Multi-App Architecture
- Production Deployment (nginx, SSL, monitoring)
- Troubleshooting

---
© 2026 Tlink Technologies. All rights reserved.
