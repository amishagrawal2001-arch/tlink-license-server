# Tlink License Server

Centralized license management server for all Tlink products.

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

---
© 2026 Tlink Technologies. All rights reserved.
