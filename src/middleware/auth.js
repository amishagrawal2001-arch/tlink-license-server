const jwt = require('jsonwebtoken')
const config = require('../config')

function authMiddleware (req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, config.jwtSecret)
    // Admin endpoints must reject license-holder tokens (typ: access/refresh).
    // Accept only tokens minted by /api/auth/login (typ: admin).
    if (decoded.typ !== 'admin') {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authMiddleware
