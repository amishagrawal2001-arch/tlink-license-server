const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const config = require('../config')

// ─── RSA keypair management ─────────────────────────────────────────────────
//
// Offline-activation blobs are RS256-signed JWTs. Clients verify them locally
// against the server's public key (fetched once via /api/licenses/public-key
// and cached). Never ship the private key.

const keyDir = path.resolve(path.dirname(config.databasePath), 'offline-keys')
const privateKeyPath = path.join(keyDir, 'offline-private.pem')
const publicKeyPath = path.join(keyDir, 'offline-public.pem')

let cachedPublicKey = null
let cachedPrivateKey = null

function ensureKeypair () {
    if (cachedPrivateKey && cachedPublicKey) {
        return { privateKey: cachedPrivateKey, publicKey: cachedPublicKey }
    }

    if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 })
    }

    if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
        console.log('  [offline] Generating RSA-2048 keypair for offline activation codes...')
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        })
        fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 })
        fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 })
    }

    cachedPrivateKey = fs.readFileSync(privateKeyPath, 'utf8')
    cachedPublicKey = fs.readFileSync(publicKeyPath, 'utf8')
    return { privateKey: cachedPrivateKey, publicKey: cachedPublicKey }
}

function getPublicKey () {
    return ensureKeypair().publicKey
}

/**
 * Signs an offline-activation blob. Claims deliberately kept small so the
 * resulting token fits comfortably in an email or QR code.
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {string} opts.email
 * @param {number} opts.licenseId
 * @param {string} opts.productCode
 * @param {string} opts.licenseType        // INDIVIDUAL | TEAM
 * @param {string} opts.billingType        // PAID | TRIAL
 * @param {string} [opts.startDate]        // YYYY-MM-DD
 * @param {string} [opts.endDate]          // YYYY-MM-DD (entitlement expiry)
 * @param {number} opts.validForDays       // how long the OFFLINE session lasts
 * @param {string} [opts.deviceFingerprintHash]  // if present, binds to device
 */
function mintOfflineCode (opts) {
    const { privateKey } = ensureKeypair()
    const now = Math.floor(Date.now() / 1000)
    const validFor = Math.max(1, opts.validForDays || 30) * 24 * 60 * 60
    const payload = {
        typ: 'offline',
        sub: String(opts.userId),
        email: opts.email,
        license_id: String(opts.licenseId),
        product_code: opts.productCode,
        license_type: opts.licenseType,
        billing_type: opts.billingType,
        start_date: opts.startDate || null,
        end_date: opts.endDate || null,
        device_fingerprint_hash: opts.deviceFingerprintHash || null,
        iat: now,
        exp: now + validFor,
        jti: crypto.randomBytes(16).toString('hex'),
    }
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' })
}

module.exports = { ensureKeypair, getPublicKey, mintOfflineCode }
