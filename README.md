# Tlink License Server

Centralized license management for Tlink products. Email + password auth, JWT access/refresh tokens, device fingerprint binding, per-user entitlements.

**[Admin Dashboard](http://localhost:4000/admin)** | [API Health](http://localhost:4000/api/health) | [Postman Collection](./postman/tlink-license.postman_collection.json)

## Quick Start

```bash
npm install
npm run seed    # Creates admin user + sample apps + sample users with entitlements
npm start       # Starts on http://localhost:4000
```

**Admin Dashboard:** http://localhost:4000/admin
- Username: `admin`
- Password: `admin123`

**Sample end-user accounts** (all password `demo1234`):
- `trial@demo.com` — INDIVIDUAL / TRIAL
- `individual@demo.com` — INDIVIDUAL / PAID
- `team@demo.com` — TEAM / PAID (multi-product)
- `team-trial@demo.com` — TEAM / TRIAL
- `expired@demo.com` — expired (for testing error flows)

Seeded apps: `tyllink_terminal`, `tyllink_studio`, `NO` (legacy).

---

## Data Model

| Table | Purpose |
|---|---|
| `users` | End-user accounts. Contains embedded `entitlements[]` per product. |
| `apps` | Registered products. Identified by `app_code`. Optional `blocked_app_versions[]`. |
| `activations` | One row per (user × license × device). Tracks `device_fingerprint_hash`, platform, app version, `last_seen_at`, `deactivated_at`. |
| `admin_users` | Admin dashboard logins (separate from end-user accounts). |

A `users` row carries:
```json
{
  "id": 2,
  "email": "niteen@example.com",
  "password_hash": "<bcrypt>",
  "name": "Niteen",
  "entitlements": [
    {
      "id": 1,
      "product_code": "tyllink_terminal",
      "license_type": "INDIVIDUAL",       // INDIVIDUAL | TEAM
      "billing_type": "PAID",             // PAID | TRIAL
      "start_date": "2026-04-18",
      "expiry_date": "2027-04-18",
      "max_devices": 3,
      "status": "active"                  // active | revoked
    }
  ]
}
```

---

## API — Public (client apps)

All endpoints live under **`/api/licenses/*`** (`/api/license/*` is kept as a deprecated alias).

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/licenses/activate` | Sign in and bind this device. Returns access + refresh tokens. |
| POST | `/api/licenses/validate` | Re-check entitlement state using the access token. |
| POST | `/api/licenses/heartbeat` | Keepalive (slim envelope). Can auto-rotate tokens. |
| POST | `/api/licenses/deactivate` | Unbind this device (frees a seat against `max_devices`). |
| POST | `/api/licenses/refresh` | Exchange refresh token for a fresh access/refresh pair. |

### Activate

**Request**
```http
POST /api/licenses/activate
Content-Type: application/json

{
  "email": "niteen@example.com",
  "password": "your-password",
  "product_code": "tyllink_terminal",
  "device_fingerprint_hash": "3c05f606ec35fb35e32fbdce88657b164056125a9ea4714812ca9a0f339b19a7",
  "platform": "macos",            // macos | windows | linux
  "os_version": "25.3.0",
  "app_version": "1.0.2",
  "mac_address": "aa:bb:cc:dd:ee:ff",   // optional
  "ip_address": "10.0.0.5"              // optional; server uses req.ip otherwise
}
```

**Success response**
```json
{
  "license_status": "VALID",
  "reason_code": "OK",
  "device_id": "10",
  "license_id": "1",
  "license_type": "INDIVIDUAL",
  "billing_type": "PAID",
  "start_date": "2026-04-18",
  "end_date":   "2027-04-18",
  "access_token":  "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi...",
  "access_expires_in_sec": 900,
  "refresh_expires_in_sec": 604800
}
```

Failure envelopes keep the same shape with `license_status: "INVALID"`, non-OK `reason_code`, and all other fields `null` (or the entitlement's `license_id` / `license_type` / `end_date` populated when the entitlement exists but is unusable — e.g. expired, revoked, device-limit-reached).

### Validate / Deactivate

Both take `Authorization: Bearer <access_token>` plus a body:

```json
{ "device_fingerprint_hash": "3c05f606ec..." }
```

`device_fingerprint_hash` is required — the server compares it to the activation's stored fingerprint to prevent token replay across machines. Mismatch returns `DEVICE_MISMATCH`.

Response shape matches Activate (minus tokens on validate).

### Heartbeat

Slim envelope. Send every ~4 hours.

**Request**
```http
POST /api/licenses/heartbeat
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "device_id":   "10",
  "license_id":  "1",
  "refresh_token": "eyJhbGciOi..."     // optional — only needed when access has expired
}
```

Token can also be supplied via body field `"authorization": "Bearer <access>"` instead of the header.

**Response** (valid, no rotation)
```json
{ "status": "VALID", "reason_code": null }
```

**Response** (valid + rotation — happens when `refresh_token` was supplied because access expired)
```json
{
  "status": "VALID",
  "reason_code": null,
  "access_token":  "eyJ...",
  "refresh_token": "eyJ...",
  "access_expires_in_sec": 900,
  "refresh_expires_in_sec": 604800
}
```

**Response** (invalid)
```json
{ "status": "INVALID", "reason_code": "SEAT_REVOKED" }
```

Heartbeat-only reason codes: `SEAT_REVOKED`, `LICENSE_EXPIRED`, `DEVICE_MISMATCH`, `null` on success.

### Refresh

**Request**
```http
POST /api/licenses/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOi...",
  "device_fingerprint_hash": "3c05f606ec..."
}
```

`device_fingerprint_hash` is required for the anti-replay check. Returns a full envelope with a fresh access+refresh pair.

---

## Reason codes (full set)

| Code | Cause | HTTP |
|---|---|---|
| `OK` | Success | 200 |
| `INVALID_REQUEST` | Missing required fields | 400 |
| `INVALID_CREDENTIALS` | Bad email or password | 401 |
| `SIGNATURE_INVALID` | Bad or expired JWT | 401 |
| `TOO_MANY_ATTEMPTS` | 5+ failed logins per email in 15 min (sliding window) | 429 |
| `PRODUCT_NOT_ENTITLED` | User has no entitlement for the product | 403 |
| `LICENSE_EXPIRED` | `expiry_date` passed | 403 |
| `SEAT_REVOKED` | Entitlement `status: "revoked"` | 403 |
| `DEVICE_LIMIT_REACHED` | `max_devices` seats all used | 403 |
| `DEVICE_ALREADY_BOUND` | Fingerprint already bound to a different user for the same product | 403 |
| `DEVICE_MISMATCH` | Token → activation mismatch, deactivated device, or fingerprint doesn't match token | 403 |
| `APP_VERSION_BLOCKED` | `app_version` is in the app's `blocked_app_versions` list | 403 |

---

## Device Fingerprint

Clients should send a stable per-machine SHA-256 hash as `device_fingerprint_hash`. The reference implementation (see `tlink-license-client/src/lib/services/fingerprint.service.ts` in the Tlink repo) combines:

```
SHA256(
    machine-uuid |     // macOS: ioreg, Linux: /etc/machine-id, Windows: registry MachineGuid
    primary-mac   |
    hostname      |
    platform      |
    arch
)
```

The server stores it verbatim on the activation row and uses it only for equality comparison — it never needs to reverse it.

---

## API — Admin (JWT-protected)

Admin JWT is obtained from `POST /api/auth/login` with admin credentials. Admin tokens carry `typ: "admin"` — end-user license tokens cannot access admin routes.

### Users
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/users?search=` | List / search users |
| POST | `/api/users` | Create user (`email`, `password`, `name`) |
| GET | `/api/users/:id` | User details with entitlements + active-device counts |
| PUT | `/api/users/:id` | Update (email, name, password) |
| DELETE | `/api/users/:id` | Delete user + cascade activations |

### Entitlements (nested under user)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/users/:id/entitlements` | Add entitlement |
| PUT | `/api/users/:id/entitlements/:entId` | Update (max_devices, dates, billing/license type, status) |
| DELETE | `/api/users/:id/entitlements/:entId` | Remove entitlement + cascade its activations |

### Activations
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/users/:id/activations` | List a user's devices |
| POST | `/api/users/:id/activations/:actId/deactivate` | Force-deactivate a device (frees the seat) |

### Apps
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/apps` | List all apps |
| POST | `/api/apps` | Register new app (`app_code`, `app_name`) |
| PUT | `/api/apps/:id` | Update name or `blocked_app_versions[]` |
| DELETE | `/api/apps/:id` | Remove app |

---

## Admin Dashboard

Open http://localhost:4000/admin. Tabs:

- **Dashboard** — user / entitlement / activation / app counts
- **Users** — expandable rows show a user's entitlements and live devices inline; add/edit/delete entitlements, force-deactivate devices, mint offline activation codes
- **Apps** — register apps, manage `blocked_app_versions` per app
- **Settings** — HTTP/HTTPS binding, CORS, admin credentials, JWT secret, DB path

---

## Environment Variables

Copy `.env.example` to `.env`. Key settings:

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `4000` |
| `HOST` | Bind address | `0.0.0.0` |
| `JWT_SECRET` | **Required in prod.** Signs access/refresh/admin tokens. | `change-me` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin credentials created on first seed | `admin` / `admin123` |
| `CORS_ORIGINS` | Comma-separated origins or `*` | `*` |
| `DATABASE_PATH` | JSON file (treated as `<path>.json`) | `./data/licenses.db` |
| `HTTPS_ENABLED` | Enable HTTPS listener | `false` |
| `HTTPS_PORT` | HTTPS port | `4443` |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | Cert files | `./certs/*.pem` |
| `SSL_AUTO_GENERATE` | Auto-generate self-signed cert if missing | `true` |

---

## Tokens and security

- **Access token** — 15-minute TTL (`typ: "access"`). Sent as Bearer. Embeds `sub` (user id), `license_id`, `device_id`, `product_code`.
- **Refresh token** — 7-day TTL (`typ: "refresh"`). Used only with `/refresh` and (optionally) `/heartbeat`.
- **Admin token** — 24h TTL (`typ: "admin"`). Required by all `/api/users`, `/api/apps`, `/api/dashboard`, `/api/settings` routes.
- **Typ-check separation** — admin middleware rejects tokens that don't carry `typ: "admin"`. License tokens can't escalate.
- **Device fingerprint binding** — every protected license endpoint compares body `device_fingerprint_hash` to the stored value on the activation row. Mismatch → `DEVICE_MISMATCH`.
- **Login rate limit** — 5 failed activations per email in a 15-minute sliding window → `TOO_MANY_ATTEMPTS`.
- **Passwords** — bcrypt (cost 10).

⚠ **HTTPS is not enforced by default.** Passwords go over the wire in plaintext on `/activate`. For any non-dev deployment enable HTTPS (see [Configuration](#environment-variables)) and prefer putting the server behind a reverse proxy that terminates TLS.

---

## Postman Collection

[`postman/tlink-license.postman_collection.json`](./postman/tlink-license.postman_collection.json) — import into Postman. Variables auto-populate from responses; run the requests in folder order and admin_token → access_token → device_id → license_id chain through automatically.

---

## Installation (Standalone Binary)

Pre-built binaries are available on the [GitHub Releases](../../releases) page — no Node.js install required.

### macOS
```bash
tar -xzf tlink-license-server-macos-arm64.tar.gz
cd tlink-license-server-macos-arm64
sudo bash install-mac.sh
```
```bash
sudo launchctl stop com.tlink.license-server
sudo launchctl start com.tlink.license-server
```

### Linux
```bash
tar -xzf tlink-license-server-linux-x64.tar.gz
cd tlink-license-server-linux-x64
sudo bash install-linux.sh
```
```bash
sudo systemctl status tlink-license-server
sudo systemctl restart tlink-license-server
sudo journalctl -u tlink-license-server -f
```

### Windows
1. Download `tlink-license-server-windows-x64.zip`
2. Extract; right-click `install-win.bat` → **Run as administrator**
```
sc stop TlinkLicenseServer
sc start TlinkLicenseServer
sc query TlinkLicenseServer
```

### Config paths after install
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

---

## Building from Source

```bash
npm install
npm run package:all    # macOS, Windows, Linux

# individual targets
npm run package:mac
npm run package:win
npm run package:linux
```

Executables land in `dist/`.

---

© 2026 Tlink Technologies. All rights reserved.
