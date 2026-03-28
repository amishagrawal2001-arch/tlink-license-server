const express = require('express')
const https = require('https')
const fs = require('fs')
const { execSync } = require('child_process')
const helmet = require('helmet')
const cors = require('cors')
const morgan = require('morgan')
const path = require('path')
const config = require('./config')
const { publicLimiter, adminLimiter } = require('./middleware/rateLimit')

// Initialize database (creates tables)
require('./database')

const app = express()

// Security
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: config.corsOrigins === '*' ? '*' : config.corsOrigins.split(',') }))
app.use(morgan('short'))
app.use(express.json())

// Serve admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')))

// Serve API documentation
app.use('/docs', express.static(path.join(__dirname, '..', 'docs')))

// Routes
app.use('/api/auth', publicLimiter, require('./routes/auth'))
app.use('/api/license', publicLimiter, require('./routes/license'))
app.use('/api/keys', adminLimiter, require('./routes/keys'))
app.use('/api/dashboard', adminLimiter, require('./routes/dashboard'))
app.use('/api/settings', adminLimiter, require('./routes/settings'))

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() })
})

// Root redirect to admin
app.get('/', (req, res) => res.redirect('/admin'))

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

const os = require('os')

function getLocalIPs () {
  const interfaces = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address })
      }
    }
  }
  return ips
}

// Generate self-signed certificate if HTTPS enabled and no cert exists
function ensureSslCerts () {
  const certDir = path.dirname(path.resolve(config.sslCertPath))
  const certPath = path.resolve(config.sslCertPath)
  const keyPath = path.resolve(config.sslKeyPath)

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
  }

  if (!config.sslAutoGenerate) {
    console.error('  ❌ SSL certificate not found and auto-generate is disabled.')
    console.error(`     Expected: ${certPath}`)
    console.error(`     Expected: ${keyPath}`)
    process.exit(1)
  }

  // Auto-generate self-signed certificate
  console.log('  📜 Generating self-signed SSL certificate...')
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true })

  try {
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=Tlink License Server/O=Tlink Technologies"`, { stdio: 'pipe' })
    console.log('  ✅ Self-signed certificate generated (valid for 365 days)')
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
  } catch (e) {
    console.error('  ❌ Failed to generate SSL certificate. Is OpenSSL installed?')
    console.error('     Install: brew install openssl (macOS) / apt install openssl (Linux)')
    console.error('     Or provide your own certs via SSL_CERT_PATH and SSL_KEY_PATH in .env')
    process.exit(1)
  }
}

// Start HTTP server
app.listen(config.port, config.host, () => {
  const ips = getLocalIPs()
  console.log(`\n  Tlink License Server v1.0.0`)
  console.log(`  ─────────────────────────────────────`)
  console.log(`  HTTP:       ${config.host}:${config.port}`)
  console.log(`  Local:      http://localhost:${config.port}`)
  ips.forEach(ip => {
    console.log(`  Network:    http://${ip.address}:${config.port}  (${ip.name})`)
  })

  // Start HTTPS server if enabled
  if (config.httpsEnabled) {
    const sslOpts = ensureSslCerts()
    if (config.sslCaPath && fs.existsSync(path.resolve(config.sslCaPath))) {
      sslOpts.ca = fs.readFileSync(path.resolve(config.sslCaPath))
    }
    https.createServer(sslOpts, app).listen(config.httpsPort, config.host, () => {
      console.log(`  ─────────────────────────────────────`)
      console.log(`  HTTPS:      ${config.host}:${config.httpsPort}`)
      console.log(`  Local:      https://localhost:${config.httpsPort}`)
      ips.forEach(ip => {
        console.log(`  Network:    https://${ip.address}:${config.httpsPort}  (${ip.name})`)
      })
    })
  }

  console.log(`  ─────────────────────────────────────`)
  console.log(`  Dashboard:  http://localhost:${config.port}/admin`)
  if (config.httpsEnabled) console.log(`  Dashboard:  https://localhost:${config.httpsPort}/admin`)
  console.log(`  API Docs:   http://localhost:${config.port}/docs`)
  console.log(`  Health:     http://localhost:${config.port}/api/health\n`)
})

module.exports = app
