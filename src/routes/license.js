const express = require('express')
const db = require('../database')
const { validateKey } = require('../services/keyValidator')

const router = express.Router()

router.post('/activate', (req, res) => {
  const { key, machineId, appCode, appVersion, os } = req.body
  if (!key || !machineId) return res.status(400).json({ error: 'key and machineId are required' })

  const validation = validateKey(key)
  if (!validation.valid) return res.status(400).json({ error: 'Invalid license key' })
  if (validation.expired) return res.status(400).json({ error: 'License key has expired' })

  const keyRecord = db.findOne('license_keys', k => k.key === key)
  if (!keyRecord) return res.status(404).json({ error: 'License key not found' })
  if (keyRecord.status === 'revoked') return res.status(403).json({ error: 'License key has been revoked' })

  if (appCode) {
    const app = db.findOne('apps', a => a.id === keyRecord.app_id)
    if (app && app.app_code !== appCode) return res.status(403).json({ error: 'Key not valid for this application' })
  }

  const activeCount = db.count('activations', a => a.key_id === keyRecord.id && !a.deactivated_at)
  const existing = db.findOne('activations', a => a.key_id === keyRecord.id && a.machine_id === machineId && !a.deactivated_at)

  if (existing) {
    db.update('activations', existing.id, { last_seen_at: new Date().toISOString(), app_version: appVersion || existing.app_version, os: os || existing.os })
    return res.json({ valid: true, tier: keyRecord.tier, expiry: keyRecord.expiry_date, customer: keyRecord.customer_name, message: 'Already activated' })
  }

  if (activeCount >= keyRecord.max_machines) {
    return res.status(403).json({ error: `Max activations reached (${keyRecord.max_machines}). Deactivate another machine first.` })
  }

  db.insert('activations', { key_id: keyRecord.id, machine_id: machineId, app_version: appVersion || '', os: os || '', ip_address: req.ip || '', last_seen_at: new Date().toISOString() })
  res.json({ valid: true, tier: keyRecord.tier, expiry: keyRecord.expiry_date, customer: keyRecord.customer_name, message: 'Activated' })
})

router.post('/validate', (req, res) => {
  const { key, machineId } = req.body
  if (!key) return res.status(400).json({ error: 'key is required' })

  const keyRecord = db.findOne('license_keys', k => k.key === key && k.status === 'active')
  if (!keyRecord) return res.json({ valid: false, reason: 'Key not found or revoked' })

  const expiry = new Date(keyRecord.expiry_date)
  const now = new Date()
  if (now > expiry) return res.json({ valid: false, reason: 'Expired', tier: keyRecord.tier, expiry: keyRecord.expiry_date })

  const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))

  if (machineId) {
    const act = db.findOne('activations', a => a.key_id === keyRecord.id && a.machine_id === machineId && !a.deactivated_at)
    if (act) db.update('activations', act.id, { last_seen_at: new Date().toISOString() })
  }

  res.json({ valid: true, tier: keyRecord.tier, expiry: keyRecord.expiry_date, daysRemaining, customer: keyRecord.customer_name })
})

router.post('/deactivate', (req, res) => {
  const { key, machineId } = req.body
  if (!key || !machineId) return res.status(400).json({ error: 'key and machineId are required' })

  const keyRecord = db.findOne('license_keys', k => k.key === key)
  if (!keyRecord) return res.status(404).json({ error: 'Key not found' })

  const act = db.findOne('activations', a => a.key_id === keyRecord.id && a.machine_id === machineId && !a.deactivated_at)
  if (act) {
    db.update('activations', act.id, { deactivated_at: new Date().toISOString() })
    return res.json({ success: true, message: 'Deactivated' })
  }
  res.json({ success: false, message: 'No active activation found' })
})

router.post('/heartbeat', (req, res) => {
  const { key, machineId } = req.body
  if (!key || !machineId) return res.status(400).json({ error: 'key and machineId are required' })

  const keyRecord = db.findOne('license_keys', k => k.key === key && k.status === 'active')
  if (!keyRecord) return res.json({ valid: false })

  const act = db.findOne('activations', a => a.key_id === keyRecord.id && a.machine_id === machineId && !a.deactivated_at)
  if (act) db.update('activations', act.id, { last_seen_at: new Date().toISOString() })

  res.json({ valid: new Date() <= new Date(keyRecord.expiry_date) })
})

module.exports = router
