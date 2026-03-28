const express = require('express')
const db = require('../database')
const authMiddleware = require('../middleware/auth')
const { generateKey } = require('../services/keyGenerator')

const router = express.Router()
router.use(authMiddleware)

router.get('/', (req, res) => {
  const { app, tier, status, customer } = req.query
  let keys = db.findAll('license_keys')

  if (app) { const a = db.findOne('apps', x => x.app_code === app); if (a) keys = keys.filter(k => k.app_id === a.id) }
  if (tier) keys = keys.filter(k => k.tier === tier)
  if (status) keys = keys.filter(k => k.status === status)
  if (customer) keys = keys.filter(k => (k.customer_name || '').toLowerCase().includes(customer.toLowerCase()) || (k.customer_email || '').toLowerCase().includes(customer.toLowerCase()))

  keys = keys.map(k => {
    const app = db.findOne('apps', a => a.id === k.app_id)
    return { ...k, app_code: app?.app_code, app_name: app?.app_name }
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  res.json({ keys, total: keys.length })
})

router.post('/', (req, res) => {
  const { appCode, tier, expiryDate, customerName, customerEmail, maxMachines = 1 } = req.body
  if (!appCode || !tier || !expiryDate) return res.status(400).json({ error: 'appCode, tier, and expiryDate are required' })

  const app = db.findOne('apps', a => a.app_code === appCode.toUpperCase())
  if (!app) return res.status(404).json({ error: `App "${appCode}" not found` })

  const generated = generateKey(appCode, tier, expiryDate, customerName)
  const result = db.insert('license_keys', { key: generated.key, app_id: app.id, tier, customer_name: customerName || '', customer_email: customerEmail || '', expiry_date: expiryDate, max_machines: maxMachines, status: 'active' })

  res.status(201).json({ id: result.lastInsertRowid, key: generated.key, appCode: generated.appCode, tier, expiry: expiryDate, customer: customerName, maxMachines })
})

router.get('/:id', (req, res) => {
  const key = db.findOne('license_keys', k => k.id === parseInt(req.params.id))
  if (!key) return res.status(404).json({ error: 'Key not found' })
  const app = db.findOne('apps', a => a.id === key.app_id)
  const activations = db.findAll('activations', a => a.key_id === key.id)
  res.json({ ...key, app_code: app?.app_code, app_name: app?.app_name, activations })
})

router.put('/:id', (req, res) => {
  const { tier, expiryDate, maxMachines, status, customerName, customerEmail } = req.body
  const changes = {}
  if (tier) changes.tier = tier
  if (expiryDate) changes.expiry_date = expiryDate
  if (maxMachines !== undefined) changes.max_machines = maxMachines
  if (status) changes.status = status
  if (customerName !== undefined) changes.customer_name = customerName
  if (customerEmail !== undefined) changes.customer_email = customerEmail

  if (Object.keys(changes).length === 0) return res.status(400).json({ error: 'No fields to update' })

  const result = db.update('license_keys', parseInt(req.params.id), changes)
  if (result.changes === 0) return res.status(404).json({ error: 'Key not found' })
  res.json({ success: true })
})

router.delete('/:id', (req, res) => {
  const result = db.update('license_keys', parseInt(req.params.id), { status: 'revoked' })
  if (result.changes === 0) return res.status(404).json({ error: 'Key not found' })
  res.json({ success: true, message: 'Key revoked' })
})

// Permanent delete — removes key and all activations from database
router.delete('/:id/permanent', (req, res) => {
  const id = parseInt(req.params.id)
  const key = db.findOne('license_keys', k => k.id === id)
  if (!key) return res.status(404).json({ error: 'Key not found' })
  // Delete all activations for this key
  db.deleteWhere('activations', a => a.key_id === id)
  // Delete the key itself
  const result = db.delete('license_keys', id)
  if (result.changes === 0) return res.status(404).json({ error: 'Key not found' })
  res.json({ success: true, message: 'Key permanently deleted' })
})

// Bulk revoke
router.post('/bulk/revoke', (req, res) => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
  let count = 0
  ids.forEach(id => {
    const result = db.update('license_keys', parseInt(id), { status: 'revoked' })
    if (result.changes > 0) count++
  })
  res.json({ success: true, message: `${count} key(s) revoked`, count })
})

// Bulk permanent delete
router.post('/bulk/delete', (req, res) => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
  let count = 0
  ids.forEach(id => {
    const intId = parseInt(id)
    db.deleteWhere('activations', a => a.key_id === intId)
    const result = db.delete('license_keys', intId)
    if (result.changes > 0) count++
  })
  res.json({ success: true, message: `${count} key(s) permanently deleted`, count })
})

router.get('/:id/activations', (req, res) => {
  const activations = db.findAll('activations', a => a.key_id === parseInt(req.params.id))
  res.json({ activations })
})

router.get('/apps/list', (req, res) => {
  res.json({ apps: db.findAll('apps') })
})

router.post('/apps/register', (req, res) => {
  const { appCode, appName } = req.body
  if (!appCode || !appName) return res.status(400).json({ error: 'appCode and appName required' })
  if (db.findOne('apps', a => a.app_code === appCode.toUpperCase())) return res.status(409).json({ error: 'App code already exists' })
  const result = db.insert('apps', { app_code: appCode.toUpperCase(), app_name: appName })
  res.status(201).json({ id: result.lastInsertRowid, appCode: appCode.toUpperCase(), appName })
})

module.exports = router
