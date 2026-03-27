const db = require('../database')

function getStats () {
  const now = new Date().toISOString().split('T')[0]
  return {
    totalKeys: db.count('license_keys'),
    activeKeys: db.count('license_keys', k => k.status === 'active'),
    revokedKeys: db.count('license_keys', k => k.status === 'revoked'),
    expiredKeys: db.count('license_keys', k => k.status === 'active' && k.expiry_date < now),
    totalActivations: db.count('activations', a => !a.deactivated_at),
    totalApps: db.count('apps'),
    tierBreakdown: ['pro', 'enterprise'].map(t => ({ tier: t, count: db.count('license_keys', k => k.status === 'active' && k.tier === t) })),
    appBreakdown: db.findAll('apps').map(a => ({ app_name: a.app_name, count: db.count('license_keys', k => k.app_id === a.id) })),
  }
}

function getRecentActivity (limit = 20) {
  return db.findAll('activations')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map(act => {
      const key = db.findOne('license_keys', k => k.id === act.key_id)
      const app = key ? db.findOne('apps', a => a.id === key.app_id) : null
      return { ...act, key: key?.key, customer_name: key?.customer_name, tier: key?.tier, app_name: app?.app_name }
    })
}

module.exports = { getStats, getRecentActivity }
