const rateLimit = require('express-rate-limit')

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = { publicLimiter, adminLimiter }
