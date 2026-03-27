const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function fnv1a (str) {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash
}

function hashToChars (hash, len) {
  let result = ''
  for (let i = 0; i < len; i++) {
    result += CHARSET[hash % CHARSET.length]
    hash = Math.floor(hash / CHARSET.length) || (hash + 7)
  }
  return result
}

function computeChecksum (segments, salt) {
  const input = segments.join('-') + '-' + salt
  const h = fnv1a(input)
  return hashToChars(h, 4)
}

function randomChars (len) {
  let result = ''
  for (let i = 0; i < len; i++) {
    result += CHARSET[Math.floor(Math.random() * CHARSET.length)]
  }
  return result
}

module.exports = { fnv1a, hashToChars, computeChecksum, randomChars, CHARSET }
