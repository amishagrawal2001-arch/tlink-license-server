const express = require('express')
const db = require('../database')
const authMiddleware = require('../middleware/auth')

const router = express.Router()
router.use(authMiddleware)

router.get('/', (req, res) => {
  const apps = db.findAll('apps').map(a => ({
    ...a,
    blocked_app_versions: a.blocked_app_versions || [],
  }))
  res.json({ apps })
})

router.post('/', (req, res) => {
  const { app_code, app_name } = req.body
  if (!app_code || !app_name) return res.status(400).json({ error: 'app_code and app_name required' })
  if (db.findOne('apps', a => a.app_code === app_code)) return res.status(409).json({ error: 'app_code already exists' })
  const result = db.insert('apps', { app_code, app_name, blocked_app_versions: [] })
  res.status(201).json({ id: result.lastInsertRowid, app_code, app_name, blocked_app_versions: [] })
})

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const app = db.findOne('apps', a => a.id === id)
  if (!app) return res.status(404).json({ error: 'App not found' })

  const { app_name, blocked_app_versions } = req.body
  const changes = {}
  if (app_name !== undefined) changes.app_name = app_name
  if (blocked_app_versions !== undefined) {
    if (!Array.isArray(blocked_app_versions)) return res.status(400).json({ error: 'blocked_app_versions must be an array' })
    changes.blocked_app_versions = blocked_app_versions.map(v => String(v).trim()).filter(Boolean)
  }
  if (Object.keys(changes).length === 0) return res.status(400).json({ error: 'No fields to update' })

  db.update('apps', id, changes)
  res.json({ ...app, ...changes })
})

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const app = db.findOne('apps', a => a.id === id)
  if (!app) return res.status(404).json({ error: 'App not found' })
  db.delete('apps', id)
  res.json({ success: true })
})

module.exports = router
