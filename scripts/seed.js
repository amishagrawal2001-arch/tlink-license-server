require('dotenv').config()
const bcrypt = require('bcryptjs')
const db = require('../src/database')
const { generateKey } = require('../src/services/keyGenerator')

console.log('\n  Seeding Tlink License Server...\n')

// 1. Create admin user
const adminUsername = process.env.ADMIN_USERNAME || 'admin'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

if (!db.findOne('admin_users', u => u.username === adminUsername)) {
  db.insert('admin_users', { username: adminUsername, password_hash: bcrypt.hashSync(adminPassword, 10), role: 'admin' })
  console.log(`  + Admin user: ${adminUsername}`)
} else {
  console.log(`  = Admin exists: ${adminUsername}`)
}

// 2. Register NetOps app
if (!db.findOne('apps', a => a.app_code === 'NO')) {
  db.insert('apps', { app_code: 'NO', app_name: 'Tlink NetOps' })
  console.log('  + App: Tlink NetOps (NO)')
} else {
  console.log('  = App exists: Tlink NetOps (NO)')
}

const app = db.findOne('apps', a => a.app_code === 'NO')

// 3. Sample keys
const samples = [
  { tier: 'pro', expiry: '2027-12-31', customer: 'Demo Pro User', email: 'pro@demo.com' },
  { tier: 'enterprise', expiry: '2027-12-31', customer: 'Demo Enterprise', email: 'enterprise@demo.com' },
  { tier: 'pro', expiry: '2025-01-01', customer: 'Expired Demo', email: 'expired@demo.com' },
]

for (const s of samples) {
  const gen = generateKey('NO', s.tier, s.expiry, s.customer)
  if (!db.findOne('license_keys', k => k.customer_name === s.customer)) {
    db.insert('license_keys', { key: gen.key, app_id: app.id, tier: s.tier, customer_name: s.customer, customer_email: s.email, expiry_date: s.expiry, max_machines: 3, status: 'active' })
    console.log(`  + Key: ${gen.key} (${s.tier})`)
  } else {
    console.log(`  = Key exists for: ${s.customer}`)
  }
}

console.log(`\n  Done! Login: ${adminUsername} / ${adminPassword}`)
console.log('  Start: npm start')
console.log('  Dashboard: http://localhost:4000/admin\n')
