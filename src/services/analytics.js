const db = require('../database')

function getStats () {
  // Count entitlements embedded on users.
  let totalEntitlements = 0
  let activeEntitlements = 0
  const now = new Date().toISOString().slice(0, 10)
  for (const u of db.findAll('users')) {
    for (const e of (u.entitlements || [])) {
      totalEntitlements++
      if (e.status === 'active' && (!e.expiry_date || e.expiry_date >= now)) activeEntitlements++
    }
  }
  return {
    totalUsers: db.count('users'),
    totalEntitlements,
    activeEntitlements,
    totalActivations: db.count('activations', a => !a.deactivated_at),
    totalApps: db.count('apps'),
  }
}

function getRecentActivity (limit = 20) {
  return db.findAll('activations')
    .sort((a, b) => new Date(b.created_at || b.last_seen_at || 0) - new Date(a.created_at || a.last_seen_at || 0))
    .slice(0, limit)
    .map(act => {
      // Resolve the owner user for this activation so the UI can show who it belongs to.
      const user = db.findOne('users', u => u.id === act.user_id) || null
      const app = db.findOne('apps', a => a.app_code === act.product_code) || null
      return {
        ...act,
        user_email: user?.email,
        user_name: user?.name,
        app_name: app?.app_name,
      }
    })
}

/**
 * Triage widgets for the admin Dashboard: counts + a small preview list for
 * each of the "needs attention" categories, plus a recent-activity feed.
 * Designed to be a single round-trip so the Dashboard paints in one shot.
 *
 * Categories:
 *   - expiringSoon — entitlements whose expiry_date is within 30 days
 *   - saturated   — entitlements at or over max_devices (pool-counted)
 *   - dangling    — users with member_of_license_id pointing at a missing /
 *                   non-TEAM entitlement (will fail /activate silently)
 *   - inactive    — users with no activation OR last_seen_at > 90 days ago
 *   - recentActivity — last N activations, newest first
 */
function getTriageWidgets (previewLimit = 6, recentLimit = 20) {
  const users = db.findAll('users')
  const activations = db.findAll('activations')
  const today = new Date().toISOString().slice(0, 10)
  const soonCutoff = new Date(); soonCutoff.setDate(soonCutoff.getDate() + 30)
  const soonStr = soonCutoff.toISOString().slice(0, 10)
  const inactiveCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  // Fresh-user grace window — provisioned users this recent can't reasonably
  // be called "inactive"; widened from 7 to 14 days so a week-long outage
  // between provisioning and first sign-in doesn't falsely flag them.
  const freshWindowMs = 14 * 24 * 60 * 60 * 1000

  // Reverse indexes keep the loops below O(n) instead of O(n·m).
  const entById = new Map()         // ent_id → { owner, ent }
  const entActiveCount = new Map()  // license_id → active activation count
  const userById = new Map()        // user_id → user  (avoids Array.find inside recent-activity loop)
  for (const u of users) {
    userById.set(u.id, u)
    for (const e of (u.entitlements || [])) entById.set(e.id, { owner: u, ent: e })
  }
  for (const a of activations) {
    if (a.deactivated_at) continue
    entActiveCount.set(a.license_id, (entActiveCount.get(a.license_id) || 0) + 1)
  }
  // user_id → latest last_seen_at (ISO). Mirrors users.js lastActiveAt().
  const lastSeenByUser = new Map()
  for (const a of activations) {
    if (!a.last_seen_at) continue
    const prev = lastSeenByUser.get(a.user_id)
    if (!prev || a.last_seen_at > prev) lastSeenByUser.set(a.user_id, a.last_seen_at)
  }
  // Effective last-seen: a team owner inherits the latest activity of any of
  // their team members. A manager who never personally activates the app
  // shouldn't appear "inactive" just because their members do the actual
  // product usage. Only widens the value — never shrinks it.
  const effectiveLastSeen = new Map(lastSeenByUser)
  for (const u of users) {
    const ownedTeamIds = (u.entitlements || [])
      .filter(e => e.license_type === 'TEAM')
      .map(e => e.id)
    if (ownedTeamIds.length === 0) continue
    let max = effectiveLastSeen.get(u.id) || null
    for (const other of users) {
      if (!other.member_of_license_id) continue
      if (!ownedTeamIds.includes(other.member_of_license_id)) continue
      const memLast = lastSeenByUser.get(other.id)
      if (memLast && (!max || memLast > max)) max = memLast
    }
    if (max) effectiveLastSeen.set(u.id, max)
  }

  const expiringSoon = []
  const saturated = []
  const dangling = []
  const inactive = []

  for (const u of users) {
    for (const e of (u.entitlements || [])) {
      if (e.status === 'revoked') continue
      // Expiring: has an expiry inside today..+30d (today INCLUDED — a license
      // expiring at end-of-day today is still valid, and admins want to see it
      // in the preview to plan renewals).
      if (e.expiry_date && e.expiry_date >= today && e.expiry_date <= soonStr) {
        expiringSoon.push({
          user_id: u.id, user_email: u.email,
          license_id: e.id,
          product_code: e.product_code,
          license_type: e.license_type,
          billing_type: e.billing_type,
          expiry_date: e.expiry_date,
        })
      }
      // Saturated: active seats ≥ max_devices
      const max = e.max_devices || 1
      const used = entActiveCount.get(e.id) || 0
      if (used >= max) {
        saturated.push({
          user_id: u.id, user_email: u.email,
          license_id: e.id,
          product_code: e.product_code,
          license_type: e.license_type,
          active_devices: used,
          max_devices: max,
        })
      }
    }
    // Dangling: member_of_license_id doesn't resolve to a TEAM entitlement,
    // OR resolves to an entitlement owned by the same user (self-membership —
    // current PUT blocks this, but legacy data may exist).
    if (u.member_of_license_id) {
      const ref = entById.get(u.member_of_license_id)
      if (!ref || ref.ent.license_type !== 'TEAM' || ref.owner.id === u.id) {
        dangling.push({
          user_id: u.id, user_email: u.email,
          dangling_license_id: u.member_of_license_id,
        })
      }
    }
    // Inactive: never seen, or effective last-seen > 90 days ago. Skip users
    // provisioned within the fresh window — they haven't had a fair chance.
    const last = effectiveLastSeen.get(u.id)
    const created = u.created_at ? new Date(u.created_at).getTime() : 0
    const fresh = created && (Date.now() - created) < freshWindowMs
    if (!last && !fresh) {
      inactive.push({ user_id: u.id, user_email: u.email, last_active_at: null, created_at: u.created_at })
    } else if (last && new Date(last).getTime() < inactiveCutoff) {
      inactive.push({ user_id: u.id, user_email: u.email, last_active_at: last, created_at: u.created_at })
    }
  }

  // Stable sorts — show most-urgent first so the preview tops are the rows an
  // admin should actually look at.
  expiringSoon.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
  saturated.sort((a, b) => (b.active_devices / b.max_devices) - (a.active_devices / a.max_devices))
  inactive.sort((a, b) => (a.last_active_at || '').localeCompare(b.last_active_at || ''))

  // Recent activity — reuse the decorated shape from getRecentActivity so the
  // client has user_email / app_name without another fetch. userById is a
  // Map lookup (O(1)) instead of the prior Array.find inside the loop.
  const recentActivity = [...activations]
    .filter(a => a.last_seen_at)
    .sort((a, b) => (b.last_seen_at || '').localeCompare(a.last_seen_at || ''))
    .slice(0, recentLimit)
    .map(act => {
      const activating = userById.get(act.user_id)
      return {
        activation_id: act.id,
        user_id: act.user_id,
        user_email: activating?.email,
        product_code: act.product_code,
        platform: act.platform,
        app_version: act.app_version,
        last_seen_at: act.last_seen_at,
        activation_source: act.activation_source || 'online',
      }
    })

  const trim = (list) => ({ total: list.length, preview: list.slice(0, previewLimit) })

  return {
    expiringSoon: trim(expiringSoon),
    saturated: trim(saturated),
    dangling: trim(dangling),
    inactive: trim(inactive),
    recentActivity,
  }
}

module.exports = { getStats, getRecentActivity, getTriageWidgets }
