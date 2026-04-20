const fs = require('fs')
const path = require('path')
const config = require('./config')

const dbPath = path.resolve(config.databasePath.replace('.db', '.json'))
const dir = path.dirname(dbPath)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

const DEFAULT_DATA = { apps: [], activations: [], admin_users: [], users: [], _counters: { apps: 0, activations: 0, admin_users: 0, users: 0, entitlements: 0 } }

class JsonDB {
  constructor (filePath) {
    this.filePath = filePath
    this.data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : { ...DEFAULT_DATA }
    if (!this.data._counters) this.data._counters = {}
    // Heal any missing counters by taking max(id) across the table so hand-edited
    // DBs or legacy files (missing keys) don't recycle ids on the next insert.
    for (const t of ['apps', 'activations', 'admin_users', 'users']) {
      if (!this.data[t]) this.data[t] = []
      const maxId = this.data[t].reduce((m, r) => Math.max(m, r.id || 0), 0)
      const stored = this.data._counters[t] || 0
      this.data._counters[t] = Math.max(stored, maxId)
    }
    // Entitlements are embedded on users — compute max across all users.
    let entMax = 0
    for (const u of this.data.users) {
      for (const e of (u.entitlements || [])) if (e.id > entMax) entMax = e.id
    }
    this.data._counters.entitlements = Math.max(this.data._counters.entitlements || 0, entMax)
  }

  nextId (table) {
    this.data._counters[table] = (this.data._counters[table] || 0) + 1
    this._save()
    return this.data._counters[table]
  }

  _save () {
    // Non-atomic write is risky — write tmp then rename.
    const tmp = this.filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, this.filePath)
  }

  insert (table, record) {
    this.data._counters[table] = (this.data._counters[table] || 0) + 1
    const id = this.data._counters[table]
    const row = { id, ...record, created_at: new Date().toISOString() }
    this.data[table].push(row)
    this._save()
    return { lastInsertRowid: id, changes: 1 }
  }

  findOne (table, predicate) {
    return this.data[table].find(predicate) || null
  }

  findAll (table, predicate) {
    return predicate ? this.data[table].filter(predicate) : [...this.data[table]]
  }

  update (table, id, changes) {
    const idx = this.data[table].findIndex(r => r.id === id)
    if (idx === -1) return { changes: 0 }
    this.data[table][idx] = { ...this.data[table][idx], ...changes, updated_at: new Date().toISOString() }
    this._save()
    return { changes: 1 }
  }

  delete (table, id) {
    const idx = this.data[table].findIndex(r => r.id === id)
    if (idx === -1) return { changes: 0 }
    this.data[table].splice(idx, 1)
    this._save()
    return { changes: 1 }
  }

  deleteWhere (table, predicate) {
    const before = this.data[table].length
    this.data[table] = this.data[table].filter(r => !predicate(r))
    this._save()
    return { changes: before - this.data[table].length }
  }

  count (table, predicate) {
    return predicate ? this.data[table].filter(predicate).length : this.data[table].length
  }
}

module.exports = new JsonDB(dbPath)
