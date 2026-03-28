const fs = require('fs')
const path = require('path')
const config = require('./config')

const dbPath = path.resolve(config.databasePath.replace('.db', '.json'))
const dir = path.dirname(dbPath)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

const DEFAULT_DATA = { apps: [], license_keys: [], activations: [], admin_users: [], _counters: { apps: 0, license_keys: 0, activations: 0, admin_users: 0 } }

class JsonDB {
  constructor (filePath) {
    this.filePath = filePath
    this.data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : { ...DEFAULT_DATA }
    if (!this.data._counters) this.data._counters = { apps: 0, license_keys: 0, activations: 0, admin_users: 0 }
  }

  _save () { fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2)) }

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
