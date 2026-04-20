const express = require('express')
const authMiddleware = require('../middleware/auth')
const { getStats, getRecentActivity, getTriageWidgets } = require('../services/analytics')

const router = express.Router()
router.use(authMiddleware)

router.get('/stats', (req, res) => {
  res.json(getStats())
})

router.get('/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 20
  res.json(getRecentActivity(limit))
})

// Dashboard triage widgets: counts + preview lists for the "needs attention"
// categories (expiring soon, saturated seats, dangling team links, inactive
// users) plus a recent-activity feed. Single round-trip so the Dashboard tab
// paints in one shot.
router.get('/triage', (req, res) => {
  res.json(getTriageWidgets())
})

module.exports = router
