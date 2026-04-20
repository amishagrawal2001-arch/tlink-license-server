require('dotenv').config()
const bcrypt = require('bcryptjs')
const db = require('../src/database')

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

// 2. Register apps (keep legacy NO, add new product codes sent by clients)
const apps = [
  { app_code: 'NO', app_name: 'Tlink NetOps' },
  { app_code: 'tyllink_terminal', app_name: 'Tyllink Terminal' },
  { app_code: 'tyllink_studio', app_name: 'Tyllink Studio' },
]
for (const a of apps) {
  if (!db.findOne('apps', x => x.app_code === a.app_code)) {
    db.insert('apps', a)
    console.log(`  + App: ${a.app_name} (${a.app_code})`)
  } else {
    console.log(`  = App exists: ${a.app_name} (${a.app_code})`)
  }
}

// 3. Sample end-user accounts with entitlements
const nextLicenseId = () => db.nextId('entitlements')

const today = new Date().toISOString().slice(0, 10)
const sampleUsers = [
  {
    email: 'trial@demo.com',
    password: 'demo1234',
    name: 'Demo Trial User',
    entitlements: [
      { product_code: 'tyllink_terminal', license_type: 'INDIVIDUAL', billing_type: 'TRIAL', start_date: today, expiry_date: '2027-12-31', max_devices: 1, status: 'active' },
    ],
  },
  {
    email: 'individual@demo.com',
    password: 'demo1234',
    name: 'Demo Individual',
    entitlements: [
      { product_code: 'tyllink_terminal', license_type: 'INDIVIDUAL', billing_type: 'PAID', start_date: today, expiry_date: '2027-12-31', max_devices: 3, status: 'active' },
    ],
  },
  {
    email: 'team@demo.com',
    password: 'demo1234',
    name: 'Demo Team',
    entitlements: [
      { product_code: 'tyllink_terminal', license_type: 'TEAM', billing_type: 'PAID', start_date: today, expiry_date: '2027-12-31', max_devices: 10, status: 'active' },
      { product_code: 'tyllink_studio', license_type: 'TEAM', billing_type: 'PAID', start_date: today, expiry_date: '2027-12-31', max_devices: 10, status: 'active' },
    ],
  },
  {
    email: 'team-trial@demo.com',
    password: 'demo1234',
    name: 'Demo Team Trial',
    entitlements: [
      { product_code: 'tyllink_terminal', license_type: 'TEAM', billing_type: 'TRIAL', start_date: today, expiry_date: '2027-12-31', max_devices: 5, status: 'active' },
    ],
  },
  {
    email: 'expired@demo.com',
    password: 'demo1234',
    name: 'Expired Demo',
    entitlements: [
      { product_code: 'tyllink_terminal', license_type: 'INDIVIDUAL', billing_type: 'PAID', start_date: '2024-01-01', expiry_date: '2025-01-01', max_devices: 1, status: 'active' },
    ],
  },
]

for (const u of sampleUsers) {
  if (!db.findOne('users', x => x.email === u.email)) {
    db.insert('users', {
      email: u.email,
      password_hash: bcrypt.hashSync(u.password, 10),
      name: u.name,
      entitlements: u.entitlements.map(e => ({ id: nextLicenseId(), ...e })),
    })
    console.log(`  + User: ${u.email} (${u.entitlements.map(e => `${e.product_code}/${e.license_type}/${e.billing_type}`).join(', ')})`)
  } else {
    console.log(`  = User exists: ${u.email}`)
  }
}

// 4. Sample team members — pool into team@demo.com's tyllink_terminal seats.
// Done after the main loop so the owner's entitlement id is already assigned.
const teamOwner = db.findOne('users', u => u.email === 'team@demo.com')
const teamEnt = teamOwner && (teamOwner.entitlements || []).find(e => e.product_code === 'tyllink_terminal' && e.license_type === 'TEAM')
if (teamEnt) {
  const teamMembers = [
    { email: 'alice@team.demo.com', name: 'Alice (team member)' },
    { email: 'bob@team.demo.com', name: 'Bob (team member)' },
  ]
  for (const m of teamMembers) {
    if (!db.findOne('users', x => x.email === m.email)) {
      db.insert('users', {
        email: m.email,
        password_hash: bcrypt.hashSync('demo1234', 10),
        name: m.name,
        entitlements: [],
        member_of_license_id: teamEnt.id,
      })
      console.log(`  + Team member: ${m.email} → team@demo.com/${teamEnt.product_code} (license id ${teamEnt.id})`)
    } else {
      console.log(`  = Team member exists: ${m.email}`)
    }
  }
}

console.log(`\n  Done! Admin login: ${adminUsername} / ${adminPassword}`)
console.log('  Sample user logins (password demo1234):')
console.log('    Owners:  trial@demo.com | individual@demo.com | team@demo.com | team-trial@demo.com')
console.log('    Members: alice@team.demo.com | bob@team.demo.com (share team@demo.com\'s tyllink_terminal pool)')
console.log('  Start: npm start')
console.log('  Dashboard: http://localhost:4000/admin\n')
