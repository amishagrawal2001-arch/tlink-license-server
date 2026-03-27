const express = require('express')
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

app.listen(config.port, config.host, () => {
  const ips = getLocalIPs()
  console.log(`\n  Tlink License Server v1.0.0`)
  console.log(`  ─────────────────────────────────────`)
  console.log(`  Binding:    ${config.host}:${config.port}`)
  console.log(`  Local:      http://localhost:${config.port}`)
  ips.forEach(ip => {
    console.log(`  Network:    http://${ip.address}:${config.port}  (${ip.name})`)
  })
  console.log(`  ─────────────────────────────────────`)
  console.log(`  Dashboard:  http://localhost:${config.port}/admin`)
  console.log(`  API Docs:   http://localhost:${config.port}/docs`)
  console.log(`  Health:     http://localhost:${config.port}/api/health\n`)
})

module.exports = app
