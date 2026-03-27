const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../database')
const config = require('../config')

const router = express.Router()

router.post('/login', (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })

  const user = db.findOne('admin_users', u => u.username === username)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, config.jwtSecret, { expiresIn: '24h' })
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } })
})

module.exports = router
