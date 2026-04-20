const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../database')
const config = require('../config')
const { getPublicKey } = require('../services/offlineCode')

const router = express.Router()

// Unauthenticated — clients fetch this once at first launch and cache it to
// verify offline activation codes locally without needing to reach the server.
router.get('/public-key', (req, res) => {
  res.type('application/x-pem-file').send(getPublicKey())
})

const ACCESS_TTL_SEC = 900
const REFRESH_TTL_SEC = 604800
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5

const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')

const REASON = {
  OK: 'OK',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PRODUCT_NOT_ENTITLED: 'PRODUCT_NOT_ENTITLED',
  LICENSE_EXPIRED: 'LICENSE_EXPIRED',
  SEAT_REVOKED: 'SEAT_REVOKED',
  DEVICE_LIMIT_REACHED: 'DEVICE_LIMIT_REACHED',
  DEVICE_ALREADY_BOUND: 'DEVICE_ALREADY_BOUND',
  DEVICE_MISMATCH: 'DEVICE_MISMATCH',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  APP_VERSION_BLOCKED: 'APP_VERSION_BLOCKED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  INVALID_REQUEST: 'INVALID_REQUEST',
}

// In-memory failed-login tracker (resets on restart). Sliding window: we
// store timestamps of each failed attempt and count only those still inside
// LOGIN_WINDOW_MS. Prevents the "reset on oldest eviction" bypass.
// Key: normalized email. Value: number[] of attempt timestamps.
const loginAttempts = new Map()

function recentAttempts (key) {
  const ts = loginAttempts.get(key)
  if (!ts) return []
  const cutoff = Date.now() - LOGIN_WINDOW_MS
  const fresh = ts.filter(t => t > cutoff)
  if (fresh.length !== ts.length) {
    if (fresh.length === 0) loginAttempts.delete(key)
    else loginAttempts.set(key, fresh)
  }
  return fresh
}

function recordFailedLogin (email) {
  const key = normEmail(email)
  if (!key) return
  const ts = recentAttempts(key)
  ts.push(Date.now())
  loginAttempts.set(key, ts)
}

function isRateLimited (email) {
  const key = normEmail(email)
  return recentAttempts(key).length >= LOGIN_MAX_ATTEMPTS
}

function clearFailedLogins (email) {
  loginAttempts.delete(normEmail(email))
}

function invalid (reason, status = 400, extra = {}) {
  return {
    status,
    body: {
      license_status: 'INVALID',
      reason_code: reason,
      user_email: null,
      device_id: null,
      license_id: null,
      license_type: null,
      billing_type: null,
      start_date: null,
      end_date: null,
      access_token: null,
      refresh_token: null,
      access_expires_in_sec: null,
      refresh_expires_in_sec: null,
      ...extra,
    },
  }
}

function success (user, ent, activation, tokens) {
  return {
    license_status: 'VALID',
    reason_code: REASON.OK,
    user_email: user ? user.email : null,
    device_id: String(activation.id),
    license_id: String(ent.id),
    license_type: ent.license_type,
    billing_type: ent.billing_type,
    start_date: ent.start_date || null,
    end_date: ent.expiry_date || null,
    access_token: tokens ? tokens.accessToken : null,
    refresh_token: tokens ? tokens.refreshToken : null,
    access_expires_in_sec: tokens ? ACCESS_TTL_SEC : null,
    refresh_expires_in_sec: tokens ? REFRESH_TTL_SEC : null,
  }
}

function issueTokens (user, ent, activation) {
  const claims = { sub: user.id, license_id: ent.id, device_id: activation.id, product_code: ent.product_code }
  const accessToken = jwt.sign({ ...claims, typ: 'access' }, config.jwtSecret, { expiresIn: ACCESS_TTL_SEC })
  const refreshToken = jwt.sign({ ...claims, typ: 'refresh' }, config.jwtSecret, { expiresIn: REFRESH_TTL_SEC })
  return { accessToken, refreshToken }
}

function verifyToken (token, expectedTyp) {
  try {
    const decoded = jwt.verify(token, config.jwtSecret)
    if (decoded.typ !== expectedTyp) return null
    return decoded
  } catch {
    return null
  }
}

function bearer (req) {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice(7)
}

// requireFp: if true (the default), reject when body device_fingerprint_hash
// is missing or doesn't match the activation. Prevents token replay from a
// different machine.
// Find an entitlement by its globally-unique id across all users. Returns
// { owner, ent } or null. Used for team members whose user record does NOT
// own the entitlement — the entitlement lives on a different (owner) user.
function findEntitlementById (licenseId) {
  for (const u of db.findAll('users')) {
    const ent = (u.entitlements || []).find(e => e.id === licenseId)
    if (ent) return { owner: u, ent }
  }
  return null
}

// Resolve which entitlement a user should activate against for a given
// product. Owners fall through the normal path (their own entitlements[]);
// team members have `member_of_license_id` pointing to a TEAM entitlement
// on someone else's user record — we dereference that and confirm the
// product_code matches what the client asked for.
function resolveEntitlementForProduct (user, productCode) {
  const own = (user.entitlements || []).find(e => e.product_code === productCode)
  if (own) return own
  if (user.member_of_license_id) {
    const teamRef = findEntitlementById(user.member_of_license_id)
    if (teamRef && teamRef.ent.product_code === productCode && teamRef.ent.license_type === 'TEAM') {
      return teamRef.ent
    }
  }
  return null
}

// Same as the inline lookup in resolveFromToken but for callers (heartbeat,
// refresh) that have their own validation scaffolding and just need the ent.
function resolveEntitlementForToken (user, licenseId) {
  const own = (user.entitlements || []).find(e => e.id === licenseId)
  if (own) return own
  if (user.member_of_license_id === licenseId) {
    const teamRef = findEntitlementById(licenseId)
    if (teamRef && teamRef.ent.license_type === 'TEAM') return teamRef.ent
  }
  return null
}

function resolveFromToken (req, expectedTyp = 'access', opts = {}) {
  const requireFp = opts.requireFp !== false
  const token = bearer(req)
  if (!token) return { error: invalid(REASON.SIGNATURE_INVALID, 401) }
  const decoded = verifyToken(token, expectedTyp)
  if (!decoded) return { error: invalid(REASON.SIGNATURE_INVALID, 401) }

  const user = db.findOne('users', u => u.id === decoded.sub)
  // If the user/entitlement is gone, SEAT_REVOKED communicates the state more
  // accurately than SIGNATURE_INVALID (the token is real; the seat is not).
  if (!user) return { error: invalid(REASON.SEAT_REVOKED, 403) }

  // If the token's license_id no longer resolves — entitlement deleted,
  // license_type flipped from TEAM to INDIVIDUAL, or the user was removed
  // from a team — return SEAT_REVOKED rather than the generic "no product"
  // message. The token was valid at issue time; something changed since.
  const ent = resolveEntitlementForToken(user, decoded.license_id)
  if (!ent) return { error: invalid(REASON.SEAT_REVOKED, 403) }

  const activation = db.findOne('activations', a => a.id === decoded.device_id)
  if (!activation || activation.deactivated_at) return { error: invalid(REASON.DEVICE_MISMATCH, 403) }

  const bodyFp = req.body && req.body.device_fingerprint_hash
  if (requireFp && !bodyFp) return { error: invalid(REASON.DEVICE_MISMATCH, 403) }
  if (bodyFp && bodyFp !== activation.device_fingerprint_hash) {
    return { error: invalid(REASON.DEVICE_MISMATCH, 403) }
  }

  return { user, ent, activation, decoded }
}

function entitlementExpired (ent) {
  return ent.expiry_date && new Date() > new Date(ent.expiry_date)
}

function entExtra (ent) {
  if (!ent) return {}
  return {
    license_id: String(ent.id),
    license_type: ent.license_type,
    billing_type: ent.billing_type,
    end_date: ent.expiry_date || null,
  }
}

function checkEntitlement (ent) {
  if (!ent) return REASON.PRODUCT_NOT_ENTITLED
  if (ent.status === 'revoked') return REASON.SEAT_REVOKED
  if (entitlementExpired(ent)) return REASON.LICENSE_EXPIRED
  return null
}

function isAppVersionBlocked (productCode, appVersion) {
  if (!appVersion) return false
  const app = db.findOne('apps', a => a.app_code === productCode)
  if (!app || !Array.isArray(app.blocked_app_versions)) return false
  const v = String(appVersion).trim()
  return app.blocked_app_versions.some(b => String(b).trim() === v)
}

router.post('/activate', (req, res) => {
  const { password, product_code, device_fingerprint_hash, platform, os_version, app_version, mac_address, ip_address } = req.body
  const email = normEmail(req.body && req.body.email)

  if (!email || !password || !product_code || !device_fingerprint_hash) {
    const out = invalid(REASON.INVALID_REQUEST, 400)
    return res.status(out.status).json(out.body)
  }

  if (isRateLimited(email)) {
    const out = invalid(REASON.TOO_MANY_ATTEMPTS, 429)
    return res.status(out.status).json(out.body)
  }

  const user = db.findOne('users', u => normEmail(u.email) === email)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedLogin(email)
    const reason = isRateLimited(email) ? REASON.TOO_MANY_ATTEMPTS : REASON.INVALID_CREDENTIALS
    const status = reason === REASON.TOO_MANY_ATTEMPTS ? 429 : 401
    const out = invalid(reason, status)
    return res.status(out.status).json(out.body)
  }
  clearFailedLogins(email)

  if (isAppVersionBlocked(product_code, app_version)) {
    const out = invalid(REASON.APP_VERSION_BLOCKED, 403)
    return res.status(out.status).json(out.body)
  }

  // Resolve entitlement: either owned by this user, or a TEAM entitlement
  // this user has been added to as a member. Same enforcement path either way.
  const ent = resolveEntitlementForProduct(user, product_code)
  const entReason = checkEntitlement(ent)
  if (entReason) {
    const out = invalid(entReason, 403, entExtra(ent))
    return res.status(out.status).json(out.body)
  }

  // Block if this fingerprint is already bound to a different user for the same product.
  const foreign = db.findOne('activations', a =>
    a.product_code === product_code &&
    a.device_fingerprint_hash === device_fingerprint_hash &&
    a.user_id !== user.id &&
    !a.deactivated_at)
  if (foreign) {
    const out = invalid(REASON.DEVICE_ALREADY_BOUND, 403, entExtra(ent))
    return res.status(out.status).json(out.body)
  }

  let activation = db.findOne('activations', a =>
    a.user_id === user.id &&
    a.license_id === ent.id &&
    a.device_fingerprint_hash === device_fingerprint_hash &&
    !a.deactivated_at)

  if (activation) {
    db.update('activations', activation.id, {
      last_seen_at: new Date().toISOString(),
      platform: platform || activation.platform,
      os_version: os_version || activation.os_version,
      app_version: app_version || activation.app_version,
      mac_address: mac_address || activation.mac_address,
      ip_address: ip_address || activation.ip_address,
    })
    activation = db.findOne('activations', a => a.id === activation.id)
  } else {
    const maxDevices = ent.max_devices || 1
    // Count the full pool of active seats on this entitlement across ALL
    // users — for TEAM entitlements, members share the pool; for individual
    // entitlements, there's only one user anyway so the result is the same.
    const activeCount = db.count('activations', a =>
      a.license_id === ent.id &&
      !a.deactivated_at)

    if (activeCount >= maxDevices) {
      const out = invalid(REASON.DEVICE_LIMIT_REACHED, 403, entExtra(ent))
      return res.status(out.status).json(out.body)
    }

    const { lastInsertRowid } = db.insert('activations', {
      user_id: user.id,
      license_id: ent.id,
      product_code,
      device_fingerprint_hash,
      platform: platform || '',
      os_version: os_version || '',
      app_version: app_version || '',
      mac_address: mac_address || '',
      ip_address: ip_address || req.ip || '',
      last_seen_at: new Date().toISOString(),
    })
    activation = db.findOne('activations', a => a.id === lastInsertRowid)
  }

  const tokens = issueTokens(user, ent, activation)
  res.json(success(user, ent, activation, tokens))
})

router.post('/validate', (req, res) => {
  const ctx = resolveFromToken(req, 'access')
  if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)

  if (isAppVersionBlocked(ctx.ent.product_code, req.body && req.body.app_version)) {
    const out = invalid(REASON.APP_VERSION_BLOCKED, 403)
    return res.status(out.status).json(out.body)
  }

  const entReason = checkEntitlement(ctx.ent)
  if (entReason) {
    const out = invalid(entReason, 403, entExtra(ctx.ent))
    return res.status(out.status).json(out.body)
  }

  db.update('activations', ctx.activation.id, { last_seen_at: new Date().toISOString() })
  res.json(success(ctx.user, ctx.ent, ctx.activation, null))
})

// Heartbeat uses a slim response envelope: { status, reason_code } plus new
// tokens when a refresh_token is supplied and rotation succeeds.
//
// Request body: { device_id, license_id, authorization?, refresh_token? }
// Token source: Authorization header (preferred) or body `authorization` field.
// Cross-check: token claims.device_id/license_id must match body values.
// Reason codes: SEAT_REVOKED | DEVICE_MISMATCH | LICENSE_EXPIRED | null.
router.post('/heartbeat', (req, res) => {
  const { device_id, license_id, refresh_token: bodyRefresh, authorization: bodyAuth } = req.body || {}
  const slim = (status, reason_code, extra = {}) => res.status(status === 'VALID' ? 200 : 401).json({ status, reason_code, ...extra })

  if (!device_id || !license_id) {
    return slim('INVALID', REASON.DEVICE_MISMATCH)
  }

  // Pull the access token from header or body.
  let accessToken = bearer(req)
  if (!accessToken && typeof bodyAuth === 'string' && bodyAuth.startsWith('Bearer ')) {
    accessToken = bodyAuth.slice(7)
  }

  let decoded = accessToken ? verifyToken(accessToken, 'access') : null
  let rotatedTokens = null

  // If access missing/expired and a refresh_token is supplied, try rotation.
  if (!decoded && bodyRefresh) {
    const rdec = verifyToken(bodyRefresh, 'refresh')
    if (!rdec) return slim('INVALID', REASON.DEVICE_MISMATCH)
    // Use refresh claims as the decoded identity.
    decoded = rdec
    // Defer issuing new tokens until entitlement/device checks pass below.
    rotatedTokens = true
  }

  if (!decoded) return slim('INVALID', REASON.DEVICE_MISMATCH)

  // Cross-check body ids against token claims.
  if (String(decoded.device_id) !== String(device_id) || String(decoded.license_id) !== String(license_id)) {
    return slim('INVALID', REASON.DEVICE_MISMATCH)
  }

  const user = db.findOne('users', u => u.id === decoded.sub)
  // User account deleted since the token was issued → seat is gone, not
  // a device-level problem. Same for the entitlement disappearing or the
  // user losing their team membership.
  if (!user) return slim('INVALID', REASON.SEAT_REVOKED)

  const ent = resolveEntitlementForToken(user, decoded.license_id)
  if (!ent) return slim('INVALID', REASON.SEAT_REVOKED)
  if (ent.status === 'revoked') return slim('INVALID', REASON.SEAT_REVOKED)
  if (entitlementExpired(ent)) return slim('INVALID', REASON.LICENSE_EXPIRED)

  const activation = db.findOne('activations', a => a.id === decoded.device_id)
  if (!activation || activation.deactivated_at) return slim('INVALID', REASON.DEVICE_MISMATCH)

  db.update('activations', activation.id, { last_seen_at: new Date().toISOString() })

  const extra = {}
  if (rotatedTokens) {
    const tokens = issueTokens(user, ent, activation)
    extra.access_token = tokens.accessToken
    extra.refresh_token = tokens.refreshToken
    extra.access_expires_in_sec = ACCESS_TTL_SEC
    extra.refresh_expires_in_sec = REFRESH_TTL_SEC
  }

  return slim('VALID', null, extra)
})

router.post('/deactivate', (req, res) => {
  const ctx = resolveFromToken(req, 'access')
  if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)

  db.update('activations', ctx.activation.id, { deactivated_at: new Date().toISOString() })
  res.json({
    license_status: 'INVALID',
    reason_code: REASON.OK,
    user_email: ctx.user ? ctx.user.email : null,
    device_id: String(ctx.activation.id),
    license_id: String(ctx.ent.id),
    license_type: ctx.ent.license_type,
    billing_type: ctx.ent.billing_type,
    start_date: ctx.ent.start_date || null,
    end_date: ctx.ent.expiry_date || null,
    access_token: null,
    refresh_token: null,
    access_expires_in_sec: null,
    refresh_expires_in_sec: null,
  })
})

router.post('/refresh', (req, res) => {
  const token = (req.body && req.body.refresh_token) || bearer(req)
  const bodyFp = req.body && req.body.device_fingerprint_hash
  if (!token) {
    const out = invalid(REASON.INVALID_REQUEST, 400)
    return res.status(out.status).json(out.body)
  }
  if (!bodyFp) {
    const out = invalid(REASON.DEVICE_MISMATCH, 403)
    return res.status(out.status).json(out.body)
  }

  const decoded = verifyToken(token, 'refresh')
  if (!decoded) {
    const out = invalid(REASON.SIGNATURE_INVALID, 401)
    return res.status(out.status).json(out.body)
  }

  const user = db.findOne('users', u => u.id === decoded.sub)
  if (!user) {
    const out = invalid(REASON.SEAT_REVOKED, 403)
    return res.status(out.status).json(out.body)
  }

  const ent = resolveEntitlementForToken(user, decoded.license_id)
  // Refresh-time entitlement missing = seat was revoked post-issue. Other
  // terminal states (revoked / expired) use checkEntitlement as usual.
  const entReason = ent ? checkEntitlement(ent) : REASON.SEAT_REVOKED
  if (entReason) {
    const out = invalid(entReason, 403, entExtra(ent))
    return res.status(out.status).json(out.body)
  }

  const activation = db.findOne('activations', a => a.id === decoded.device_id)
  if (!activation || activation.deactivated_at || activation.device_fingerprint_hash !== bodyFp) {
    const out = invalid(REASON.DEVICE_MISMATCH, 403)
    return res.status(out.status).json(out.body)
  }

  const tokens = issueTokens(user, ent, activation)
  res.json(success(user, ent, activation, tokens))
})

// ─── Self-service device management ──────────────────────────────────────
//
// End-users manage their own devices without admin intervention. Authenticated
// by the regular license access_token; fingerprint is *not* required for these
// routes because the user may be querying from a different device than the one
// being managed (e.g. a phone showing the portal to deactivate a stolen laptop).

function resolveUserFromAccessToken (req) {
  const token = bearer(req)
  if (!token) return { error: invalid(REASON.SIGNATURE_INVALID, 401) }
  const decoded = verifyToken(token, 'access')
  if (!decoded) return { error: invalid(REASON.SIGNATURE_INVALID, 401) }
  const user = db.findOne('users', u => u.id === decoded.sub)
  if (!user) return { error: invalid(REASON.SEAT_REVOKED, 403) }
  return { user, decoded }
}

// List the signed-in user's own activations (all products).
router.get('/devices', (req, res) => {
  const ctx = resolveUserFromAccessToken(req)
  if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)
  const activations = db.findAll('activations', a => a.user_id === ctx.user.id)
    .map(a => ({
      id: String(a.id),
      product_code: a.product_code,
      license_id: String(a.license_id),
      platform: a.platform,
      os_version: a.os_version,
      app_version: a.app_version,
      ip_address: a.ip_address,
      mac_address: a.mac_address,
      device_fingerprint_hash: a.device_fingerprint_hash,
      last_seen_at: a.last_seen_at,
      deactivated_at: a.deactivated_at,
      created_at: a.created_at,
      // Flag the device that owns the token we were called with — UI can
      // highlight / prevent the user from yanking the seat out from under themselves.
      is_current: String(a.id) === String(ctx.decoded.device_id),
    }))
    .sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')))
  res.json({ devices: activations })
})

// Deactivate one of the user's own devices.
router.post('/devices/:actId/deactivate', (req, res) => {
  const ctx = resolveUserFromAccessToken(req)
  if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)
  const actId = parseInt(req.params.actId, 10)
  const act = db.findOne('activations', a => a.id === actId && a.user_id === ctx.user.id)
  if (!act) return res.status(404).json({ error: 'Device not found or does not belong to you' })
  if (act.deactivated_at) return res.json({ success: true, message: 'Already deactivated' })
  db.update('activations', actId, { deactivated_at: new Date().toISOString() })
  res.json({ success: true })
})

module.exports = router
