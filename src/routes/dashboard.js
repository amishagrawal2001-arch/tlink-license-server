const express = require('express')
const authMiddleware = require('../middleware/auth')
const { getStats, getRecentActivity } = require('../services/analytics')

const router = express.Router()
router.use(authMiddleware)

router.get('/stats', (req, res) => {
  res.json(getStats())
})

router.get('/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 20
  res.json(getRecentActivity(limit))
})

module.exports = router
