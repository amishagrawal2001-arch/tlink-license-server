const express = require('express')
const fs = require('fs')
const path = require('path')
const os = require('os')
const authMiddleware = require('../middleware/auth')

const router = express.Router()
router.use(authMiddleware)

const envPath = path.resolve(__dirname, '../../.env')

function parseEnv () {
  if (!fs.existsSync(envPath)) return {}
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
  }
  return env
}

function writeEnv (env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(envPath, lines.join('\n') + '\n')
}

// GET /api/settings — get current settings
router.get('/', (req, res) => {
  const env = parseEnv()
  res.json({
    host: env.HOST || '0.0.0.0',
    port: env.PORT || '4000',
    corsOrigins: env.CORS_ORIGINS || '*',
    adminUsername: env.ADMIN_USERNAME || 'admin',
    databasePath: env.DATABASE_PATH || './data/licenses.json',
    // Don't expose secrets fully
    jwtSecretSet: !!(env.JWT_SECRET && env.JWT_SECRET !== 'change-me-to-a-random-string'),
    keySaltSet: !!(env.KEY_SALT && env.KEY_SALT !== 'change-me-to-another-random-string'),
    // HTTPS
    httpsEnabled: env.HTTPS_ENABLED === 'true',
    httpsPort: env.HTTPS_PORT || '4443',
    sslCertPath: env.SSL_CERT_PATH || './certs/cert.pem',
    sslKeyPath: env.SSL_KEY_PATH || './certs/key.pem',
    sslAutoGenerate: env.SSL_AUTO_GENERATE !== 'false',
    networkAddresses: Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => ({ name: i.address.startsWith('192') ? 'LAN' : i.address.startsWith('10.') ? 'VPN/Private' : 'Network', address: i.address })),
  })
})

// PUT /api/settings — update settings (requires server restart)
router.put('/', (req, res) => {
  const { host, port, corsOrigins, adminUsername, adminPassword, jwtSecret, keySalt, databasePath } = req.body
  const env = parseEnv()

  if (host !== undefined) env.HOST = host
  if (port) env.PORT = String(port)
  if (corsOrigins !== undefined) env.CORS_ORIGINS = corsOrigins
  if (adminUsername) env.ADMIN_USERNAME = adminUsername
  if (adminPassword) env.ADMIN_PASSWORD = adminPassword
  if (jwtSecret) env.JWT_SECRET = jwtSecret
  if (keySalt) env.KEY_SALT = keySalt
  if (databasePath) env.DATABASE_PATH = databasePath
  // HTTPS settings
  if (req.body.httpsEnabled !== undefined) env.HTTPS_ENABLED = String(req.body.httpsEnabled)
  if (req.body.httpsPort) env.HTTPS_PORT = String(req.body.httpsPort)
  if (req.body.sslCertPath) env.SSL_CERT_PATH = req.body.sslCertPath
  if (req.body.sslKeyPath) env.SSL_KEY_PATH = req.body.sslKeyPath
  if (req.body.sslAutoGenerate !== undefined) env.SSL_AUTO_GENERATE = String(req.body.sslAutoGenerate)

  try {
    writeEnv(env)
    res.json({ success: true, message: 'Settings saved. Restart the server for changes to take effect.', requiresRestart: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings: ' + err.message })
  }
})

// POST /api/settings/restart — restart the server
router.post('/restart', (req, res) => {
  res.json({ success: true, message: 'Server restarting...' })
  setTimeout(() => {
    process.exit(0) // Process manager (PM2/systemd) will restart it
  }, 500)
})

// POST /api/settings/shutdown — stop the server
router.post('/shutdown', (req, res) => {
  res.json({ success: true, message: 'Server shutting down...' })
  setTimeout(() => {
    console.log('\n  Server stopped by admin.\n')
    process.exit(0)
  }, 500)
})

module.exports = router
