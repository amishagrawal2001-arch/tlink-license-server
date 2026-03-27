const config = require('../config')
const { computeChecksum } = require('../utils/crypto')

const TIER_RMAP = { P: 'pro', E: 'enterprise' }

function validateKey (key) {
  const result = { valid: false, appCode: null, tier: null, expiry: null, expired: false }

  if (!key || typeof key !== 'string') return result

  const parts = key.split('-')
  // Format: TLINK-APP-TSEG-YYMM-RAND-CHECKSUM
  if (parts.length !== 6 || parts[0] !== 'TLINK') return result

  const [prefix, appCode, tierSeg, yymm, rand, checksum] = parts

  // Validate checksum
  const expected = computeChecksum([prefix, appCode, tierSeg, yymm, rand], config.keySalt)
  if (checksum !== expected) return result

  // Decode tier
  const tierChar = tierSeg[0]
  const tier = TIER_RMAP[tierChar]
  if (!tier) return result

  // Decode expiry
  const yy = parseInt(yymm.slice(0, 2), 10)
  const mm = parseInt(yymm.slice(2, 4), 10)
  if (isNaN(yy) || isNaN(mm) || mm < 1 || mm > 12) return result

  const expiryYear = 2000 + yy
  const expiryDate = new Date(expiryYear, mm, 0) // last day of month
  const expired = new Date() > expiryDate

  return {
    valid: true,
    appCode,
    tier,
    expiry: expiryDate.toISOString().split('T')[0],
    expired,
  }
}

module.exports = { validateKey }
