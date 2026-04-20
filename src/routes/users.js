const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../database')
const authMiddleware = require('../middleware/auth')
const { mintOfflineCode } = require('../services/offlineCode')

const router = express.Router()
router.use(authMiddleware)

const LICENSE_TYPES = ['INDIVIDUAL', 'TEAM']
const BILLING_TYPES = ['TRIAL', 'PAID']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')

function nextLicenseId () {
  return db.nextId('entitlements')
}

function sanitize (user) {
  if (!user) return null
  const { password_hash, ...rest } = user
  return rest
}

function activeDeviceCount (userId, licenseId) {
  return db.count('activations', a => a.user_id === userId && a.license_id === licenseId && !a.deactivated_at)
}

// Count every active seat (across all users) against a team-shared entitlement,
// since members pool into the same `max_devices` pool.
function poolActiveDeviceCount (licenseId) {
  return db.count('activations', a => a.license_id === licenseId && !a.deactivated_at)
}

// Look up a TEAM entitlement anywhere in the users table by its id. Returns
// { owner, ent } or null. Used to validate `member_of_license_id` on write.
function findTeamEntitlement (licenseId) {
  for (const u of db.findAll('users')) {
    const ent = (u.entitlements || []).find(e => e.id === licenseId && e.license_type === 'TEAM')
    if (ent) return { owner: u, ent }
  }
  return null
}

// Count team members pointing at a given team entitlement.
function teamMemberCount (licenseId) {
  return db.count('users', u => u.member_of_license_id === licenseId)
}

// Most recent `last_seen_at` across all of this user's activations. Used by
// the admin dashboard to flag inactive accounts. Returns null if the user has
// never activated (e.g. freshly provisioned member who hasn't signed in).
function lastActiveAt (userId) {
  let max = null
  for (const a of db.findAll('activations')) {
    if (a.user_id !== userId) continue
    if (!a.last_seen_at) continue
    if (!max || a.last_seen_at > max) max = a.last_seen_at
  }
  return max
}

function decorate (user) {
  const out = sanitize(user)
  out.entitlements = (out.entitlements || []).map(e => {
    const base = {
      ...e,
      active_devices: e.license_type === 'TEAM' ? poolActiveDeviceCount(e.id) : activeDeviceCount(user.id, e.id),
    }
    if (e.license_type === 'TEAM') base.member_count = teamMemberCount(e.id)
    return base
  })
  out.last_active_at = lastActiveAt(user.id)
  // If this user is a team member, surface a short summary of the team they
  // belong to so the admin row can render "Member of: owner@example.com /
  // tyllink_terminal" without a second lookup.
  if (out.member_of_license_id) {
    const ref = findTeamEntitlement(out.member_of_license_id)
    if (ref) {
      out.team_membership = {
        license_id: ref.ent.id,
        product_code: ref.ent.product_code,
        owner_email: ref.owner.email,
        owner_name: ref.owner.name || '',
      }
    } else {
      // Membership pointer is dangling (owner deleted, entitlement removed).
      // UI can show a stale-reference warning; /activate will reject with
      // PRODUCT_NOT_ENTITLED so there's no silent access leak.
      out.team_membership = { license_id: out.member_of_license_id, dangling: true }
    }
  }
  return out
}

// List / search users
router.get('/', (req, res) => {
  const { search } = req.query
  let users = db.findAll('users')
  if (search) {
    const q = search.toLowerCase()
    users = users.filter(u => (u.email || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
  }
  users = users.map(decorate).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  res.json({ users, total: users.length })
})

// Create user. Optional `member_of_license_id` links the new account to an
// existing TEAM entitlement owned by someone else — useful for provisioning
// a team member who should share the owner's seat pool.
router.post('/', (req, res) => {
  const { password, name } = req.body
  const email = normEmail(req.body && req.body.email)
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' })
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email format' })
  if (db.findOne('users', u => normEmail(u.email) === email)) return res.status(409).json({ error: 'User already exists' })

  const memberOf = req.body?.member_of_license_id
  if (memberOf !== undefined && memberOf !== null && memberOf !== '') {
    const licenseId = parseInt(memberOf, 10)
    if (!Number.isFinite(licenseId) || licenseId < 1) {
      return res.status(400).json({ error: 'member_of_license_id must be a positive integer' })
    }
    if (!findTeamEntitlement(licenseId)) {
      return res.status(400).json({ error: 'No TEAM entitlement exists with that license id' })
    }
  }

  const record = {
    email,
    password_hash: bcrypt.hashSync(password, 10),
    name: name || '',
    entitlements: [],
  }
  if (memberOf) record.member_of_license_id = parseInt(memberOf, 10)

  const result = db.insert('users', record)
  res.status(201).json({ id: result.lastInsertRowid, email, name: name || '', member_of_license_id: record.member_of_license_id || null })
})

// Get user
router.get('/:id', (req, res) => {
  const user = db.findOne('users', u => u.id === parseInt(req.params.id))
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(decorate(user))
})

// Update user (name, email, password, team membership).
// Pass `member_of_license_id: null` (or empty string) to remove membership.
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const user = db.findOne('users', u => u.id === id)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const { name, password } = req.body
  const changes = {}
  const nextEmail = normEmail(req.body && req.body.email)
  if (nextEmail && nextEmail !== normEmail(user.email)) {
    if (!EMAIL_RE.test(nextEmail)) return res.status(400).json({ error: 'Invalid email format' })
    if (db.findOne('users', u => normEmail(u.email) === nextEmail && u.id !== id)) return res.status(409).json({ error: 'Email already in use' })
    changes.email = nextEmail
  }
  if (name !== undefined) changes.name = name
  if (password) changes.password_hash = bcrypt.hashSync(password, 10)

  if ('member_of_license_id' in req.body) {
    const v = req.body.member_of_license_id
    if (v === null || v === '' || v === undefined) {
      // Remove membership.
      changes.member_of_license_id = null
    } else {
      const licenseId = parseInt(v, 10)
      if (!Number.isFinite(licenseId) || licenseId < 1) {
        return res.status(400).json({ error: 'member_of_license_id must be a positive integer or null' })
      }
      const ref = findTeamEntitlement(licenseId)
      if (!ref) {
        return res.status(400).json({ error: 'No TEAM entitlement exists with that license id' })
      }
      if (ref.owner.id === id) {
        return res.status(400).json({ error: 'A user cannot be a member of their own team entitlement' })
      }
      changes.member_of_license_id = licenseId
    }
  }

  if (Object.keys(changes).length === 0) return res.status(400).json({ error: 'No fields to update' })

  db.update('users', id, changes)
  res.json({ success: true })
})

// Delete user (also deactivates their activations, any member activations on
// TEAM entitlements they owned, and clears dangling team-membership pointers
// from users who were members of those entitlements).
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const user = db.findOne('users', u => u.id === id)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const ownedEntIds = new Set((user.entitlements || []).map(e => e.id))
  // Delete activations that belong to this user OR that live on any of the
  // entitlements they owned (covers team members' activations on the owner's
  // TEAM entitlement — they'd otherwise orphan and hold seats forever).
  db.deleteWhere('activations', a => a.user_id === id || ownedEntIds.has(a.license_id))
  // Clear members pointing at any of this user's entitlements.
  for (const other of db.findAll('users')) {
    if (other.member_of_license_id && ownedEntIds.has(other.member_of_license_id)) {
      db.update('users', other.id, { member_of_license_id: null })
    }
  }
  db.delete('users', id)
  res.json({ success: true, message: 'User deleted' })
})

// Add entitlement
router.post('/:id/entitlements', (req, res) => {
  const id = parseInt(req.params.id)
  const user = db.findOne('users', u => u.id === id)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const { product_code, license_type, billing_type, start_date, expiry_date, max_devices, status } = req.body
  if (!product_code || !license_type || !billing_type || !expiry_date) {
    return res.status(400).json({ error: 'product_code, license_type, billing_type, expiry_date required' })
  }
  if (!LICENSE_TYPES.includes(license_type)) return res.status(400).json({ error: `license_type must be one of ${LICENSE_TYPES.join(', ')}` })
  if (!BILLING_TYPES.includes(billing_type)) return res.status(400).json({ error: `billing_type must be one of ${BILLING_TYPES.join(', ')}` })
  if (!db.findOne('apps', a => a.app_code === product_code)) return res.status(400).json({ error: `Unknown product_code "${product_code}"` })

  const maxDev = max_devices === undefined ? 1 : Number(max_devices)
  if (!Number.isInteger(maxDev) || maxDev < 1) return res.status(400).json({ error: 'max_devices must be a positive integer' })

  const entitlements = user.entitlements || []
  if (entitlements.some(e => e.product_code === product_code)) {
    return res.status(409).json({ error: 'User already has an entitlement for this product' })
  }

  const entitlement = {
    id: nextLicenseId(),
    product_code,
    license_type,
    billing_type,
    start_date: start_date || new Date().toISOString().slice(0, 10),
    expiry_date,
    max_devices: maxDev,
    status: status || 'active',
  }
  db.update('users', id, { entitlements: [...entitlements, entitlement] })
  res.status(201).json(entitlement)
})

// Update entitlement
router.put('/:id/entitlements/:entId', (req, res) => {
  const id = parseInt(req.params.id)
  const entId = parseInt(req.params.entId)
  const user = db.findOne('users', u => u.id === id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const entitlements = user.entitlements || []
  const idx = entitlements.findIndex(e => e.id === entId)
  if (idx === -1) return res.status(404).json({ error: 'Entitlement not found' })

  const { license_type, billing_type, start_date, expiry_date, max_devices, status } = req.body
  const updated = { ...entitlements[idx] }
  if (license_type) {
    if (!LICENSE_TYPES.includes(license_type)) return res.status(400).json({ error: `license_type must be one of ${LICENSE_TYPES.join(', ')}` })
    updated.license_type = license_type
  }
  if (billing_type) {
    if (!BILLING_TYPES.includes(billing_type)) return res.status(400).json({ error: `billing_type must be one of ${BILLING_TYPES.join(', ')}` })
    updated.billing_type = billing_type
  }
  if (start_date !== undefined) updated.start_date = start_date
  if (expiry_date !== undefined) updated.expiry_date = expiry_date
  if (max_devices !== undefined) {
    const maxDev = Number(max_devices)
    if (!Number.isInteger(maxDev) || maxDev < 1) return res.status(400).json({ error: 'max_devices must be a positive integer' })
    updated.max_devices = maxDev
  }
  if (status) updated.status = status

  const newList = [...entitlements]
  newList[idx] = updated
  db.update('users', id, { entitlements: newList })
  res.json(updated)
})

// Delete entitlement (also deactivates its activations across ALL users,
// since TEAM entitlements pool seats, and clears team-membership pointers).
router.delete('/:id/entitlements/:entId', (req, res) => {
  const id = parseInt(req.params.id)
  const entId = parseInt(req.params.entId)
  const user = db.findOne('users', u => u.id === id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const entitlements = user.entitlements || []
  const next = entitlements.filter(e => e.id !== entId)
  if (next.length === entitlements.length) return res.status(404).json({ error: 'Entitlement not found' })

  // Every activation on this license id — regardless of which team member
  // created it — belongs to this entitlement. Delete them all.
  db.deleteWhere('activations', a => a.license_id === entId)
  // Any user who was a member of this entitlement loses their membership.
  for (const other of db.findAll('users')) {
    if (other.member_of_license_id === entId) {
      db.update('users', other.id, { member_of_license_id: null })
    }
  }
  db.update('users', id, { entitlements: next })
  res.json({ success: true })
})

// List activations for a user
router.get('/:id/activations', (req, res) => {
  const id = parseInt(req.params.id)
  const activations = db.findAll('activations', a => a.user_id === id)
    .sort((a, b) => new Date(b.last_seen_at || b.created_at) - new Date(a.last_seen_at || a.created_at))
  res.json({ activations })
})

// Force-deactivate a device
router.post('/:id/activations/:actId/deactivate', (req, res) => {
  const id = parseInt(req.params.id)
  const actId = parseInt(req.params.actId)
  const act = db.findOne('activations', a => a.id === actId && a.user_id === id)
  if (!act) return res.status(404).json({ error: 'Activation not found' })
  if (act.deactivated_at) return res.json({ success: true, message: 'Already deactivated' })
  db.update('activations', actId, { deactivated_at: new Date().toISOString() })
  res.json({ success: true })
})

// Mint an offline activation code for the given user + entitlement.
// The client can redeem this without needing to reach the server.
//
// device_fingerprint_hash is REQUIRED. Offline codes bypass the normal
// /activate → /heartbeat path, so without a fingerprint binding the server
// has no way to count seats or identify which machine is using the code.
// At mint time we pre-create an activations row so the code consumes a seat
// against `max_devices` immediately; admins can evict it later like any
// other device. Re-minting for the same fingerprint reuses the existing row
// (idempotent — no double-charge).
router.post('/:id/entitlements/:entId/offline-code', (req, res) => {
  const id = parseInt(req.params.id)
  const entId = parseInt(req.params.entId)
  const owner = db.findOne('users', u => u.id === id)
  if (!owner) return res.status(404).json({ error: 'User not found' })
  const ent = (owner.entitlements || []).find(e => e.id === entId)
  if (!ent) return res.status(404).json({ error: 'Entitlement not found' })

  const validForDays = Number(req.body?.valid_for_days ?? 30)
  if (!Number.isFinite(validForDays) || validForDays < 1 || validForDays > 365) {
    return res.status(400).json({ error: 'valid_for_days must be between 1 and 365' })
  }

  const deviceFingerprintHash = (req.body?.device_fingerprint_hash || '').trim()
  if (!deviceFingerprintHash) {
    return res.status(400).json({ error: 'device_fingerprint_hash is required — ask the user to copy it from Settings → License → Device fingerprint' })
  }
  // Sanity-check shape: fingerprint is a SHA-256 hex digest (64 chars).
  if (!/^[a-f0-9]{64}$/i.test(deviceFingerprintHash)) {
    return res.status(400).json({ error: 'device_fingerprint_hash must be a 64-character hex string' })
  }

  // Optional: when the offline code is for a team MEMBER (not the entitlement
  // owner), `member_user_id` attributes the activation + the JWT `sub` claim
  // to that member. Must already be assigned to this team (member_of_license_id
  // === entId). Omitted / null = code is for the owner themselves.
  let subject = owner
  const memberParam = req.body?.member_user_id
  if (memberParam !== undefined && memberParam !== null && memberParam !== '') {
    const memberId = parseInt(memberParam, 10)
    if (!Number.isFinite(memberId) || memberId < 1) {
      return res.status(400).json({ error: 'member_user_id must be a positive integer' })
    }
    if (memberId !== owner.id) {
      if (ent.license_type !== 'TEAM') {
        return res.status(400).json({ error: 'member_user_id is only valid for TEAM entitlements' })
      }
      const member = db.findOne('users', u => u.id === memberId)
      if (!member) return res.status(404).json({ error: 'Member user not found' })
      if (member.member_of_license_id !== entId) {
        return res.status(400).json({ error: 'That user is not a member of this team entitlement' })
      }
      subject = member
    }
  }

  // Look for an existing active row for this device on this entitlement.
  // Match by fingerprint+license — the activating user can be any team member
  // or the owner, we just don't want to double-book the same machine+license.
  let activation = db.findOne('activations', a =>
    a.license_id === ent.id &&
    a.device_fingerprint_hash === deviceFingerprintHash &&
    !a.deactivated_at)

  if (!activation) {
    // Enforce the seat budget at mint time. For TEAM entitlements seats are
    // pooled across owner + all members, so count by license_id only; for
    // INDIVIDUAL entitlements there's only one user anyway, so it's the same.
    const maxDevices = ent.max_devices || 1
    const activeCount = db.count('activations', a =>
      a.license_id === ent.id &&
      !a.deactivated_at)
    if (activeCount >= maxDevices) {
      return res.status(403).json({
        error: `Device limit reached (${activeCount}/${maxDevices}). Deactivate an existing device before minting a new offline code.`,
        reason_code: 'DEVICE_LIMIT_REACHED',
      })
    }

    const { lastInsertRowid } = db.insert('activations', {
      user_id: subject.id,
      license_id: ent.id,
      product_code: ent.product_code,
      device_fingerprint_hash: deviceFingerprintHash,
      platform: '',        // filled if/when the device ever heartbeats online
      os_version: '',
      app_version: '',
      mac_address: '',
      ip_address: '',
      activation_source: 'offline',
      last_seen_at: null,
    })
    activation = db.findOne('activations', a => a.id === lastInsertRowid)
  } else if (activation.user_id !== subject.id) {
    // Re-binding: the machine already has an active row from a different
    // (user_id). Reassign it to the new subject so the offline JWT and the
    // server row agree on who owns the device.
    db.update('activations', activation.id, { user_id: subject.id, activation_source: 'offline' })
    activation = db.findOne('activations', a => a.id === activation.id)
  }

  // JWT claims carry the SUBJECT's user id + email so the client local state
  // shows the right signed-in identity. License info stays the same regardless
  // of whether this is the owner's code or a member's.
  const code = mintOfflineCode({
    userId: subject.id,
    email: subject.email,
    licenseId: ent.id,
    productCode: ent.product_code,
    licenseType: ent.license_type,
    billingType: ent.billing_type,
    startDate: ent.start_date,
    endDate: ent.expiry_date,
    validForDays,
    deviceFingerprintHash,
  })

  const expiresAt = new Date(Date.now() + validForDays * 24 * 60 * 60 * 1000).toISOString()
  res.status(201).json({
    code,
    user_email: subject.email,
    owner_email: owner.email,           // helps admin UI distinguish owner vs member codes
    is_team_member_code: subject.id !== owner.id,
    product_code: ent.product_code,
    license_type: ent.license_type,
    billing_type: ent.billing_type,
    valid_for_days: validForDays,
    expires_at: expiresAt,
    device_fingerprint_hash: deviceFingerprintHash,
    activation_id: String(activation.id),
    activation_source: activation.activation_source || 'offline',
  })
})

module.exports = router
