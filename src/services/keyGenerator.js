const config = require('../config')
const { computeChecksum, randomChars } = require('../utils/crypto')

const TIER_MAP = { pro: 'P', enterprise: 'E' }

function generateKey (appCode, tier, expiryDate, customer) {
  const tierChar = TIER_MAP[tier] || 'P'
  const expDate = new Date(expiryDate)
  const yy = String(expDate.getFullYear()).slice(-2)
  const mm = String(expDate.getMonth() + 1).padStart(2, '0')

  const seg1 = appCode.toUpperCase().padEnd(2, 'X').slice(0, 2)
  const seg2 = tierChar + randomChars(3)
  const seg3 = yy + mm
  const seg4 = randomChars(4)

  const prefix = `TLINK-${seg1}-${seg2}-${seg3}`
  const checksum = computeChecksum([`TLINK`, seg1, seg2, seg3, seg4], config.keySalt)

  return {
    key: `${prefix}-${seg4}-${checksum}`,
    appCode: seg1,
    tier,
    tierChar,
    expiry: expiryDate,
    customer,
  }
}

module.exports = { generateKey }
