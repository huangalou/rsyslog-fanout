import type { Database } from '../db/db.js'
import type { Input, Destination, RouteRule, FanoutConfig, InputCreate, DestinationCreate, RouteCreate } from './types.js'

const toInput = (r: any): Input => ({ id: r.id, name: r.name, protocol: r.protocol, port: r.port, enabled: !!r.enabled })
const toDest = (r: any): Destination => ({
  id: r.id, name: r.name, protocol: r.protocol, host: r.host, port: r.port,
  headerMode: r.header_mode, enabled: !!r.enabled,
})
const toRoute = (r: any): RouteRule => ({
  id: r.id, inputId: r.input_id, destinationId: r.destination_id,
  sourceFilter: r.source_filter, facilities: r.facilities ? JSON.parse(r.facilities) : null,
  maxSeverity: r.max_severity,
})

export interface Repo {
  listInputs(): Input[]; createInput(d: InputCreate): Input
  updateInput(id: number, d: InputCreate): Input | null; deleteInput(id: number): boolean
  listDestinations(): Destination[]; createDestination(d: DestinationCreate): Destination
  updateDestination(id: number, d: DestinationCreate): Destination | null; deleteDestination(id: number): boolean
  listRoutes(): RouteRule[]; createRoute(d: RouteCreate): RouteRule; deleteRoute(id: number): boolean
  getConfig(): FanoutConfig
  getPasswordHash(): string | null; setPasswordHash(h: string): void
  getAppliedHash(): string | null; setAppliedHash(h: string): void
}

export function createRepo(db: Database): Repo {
  const getSetting = (k: string): string | null =>
    (db.prepare('SELECT value FROM settings WHERE key=?').get(k) as any)?.value ?? null
  const setSetting = (k: string, v: string): void => {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v)
  }
  return {
    listInputs: () => (db.prepare('SELECT * FROM inputs ORDER BY id').all()).map(toInput),
    createInput(d) {
      const r = db.prepare('INSERT INTO inputs(name,protocol,port,enabled) VALUES(?,?,?,?)')
        .run(d.name, d.protocol, d.port, d.enabled ? 1 : 0)
      return { id: Number(r.lastInsertRowid), ...d }
    },
    updateInput(id, d) {
      const r = db.prepare('UPDATE inputs SET name=?,protocol=?,port=?,enabled=? WHERE id=?')
        .run(d.name, d.protocol, d.port, d.enabled ? 1 : 0, id)
      return r.changes ? { id, ...d } : null
    },
    deleteInput: (id) => db.prepare('DELETE FROM inputs WHERE id=?').run(id).changes > 0,
    listDestinations: () => (db.prepare('SELECT * FROM destinations ORDER BY id').all()).map(toDest),
    createDestination(d) {
      const r = db.prepare('INSERT INTO destinations(name,protocol,host,port,header_mode,enabled) VALUES(?,?,?,?,?,?)')
        .run(d.name, d.protocol, d.host, d.port, d.headerMode, d.enabled ? 1 : 0)
      return { id: Number(r.lastInsertRowid), ...d }
    },
    updateDestination(id, d) {
      const r = db.prepare('UPDATE destinations SET name=?,protocol=?,host=?,port=?,header_mode=?,enabled=? WHERE id=?')
        .run(d.name, d.protocol, d.host, d.port, d.headerMode, d.enabled ? 1 : 0, id)
      return r.changes ? { id, ...d } : null
    },
    deleteDestination: (id) => db.prepare('DELETE FROM destinations WHERE id=?').run(id).changes > 0,
    listRoutes: () => (db.prepare('SELECT * FROM routes ORDER BY id').all()).map(toRoute),
    createRoute(d) {
      const r = db.prepare('INSERT INTO routes(input_id,destination_id,source_filter,facilities,max_severity) VALUES(?,?,?,?,?)')
        .run(d.inputId, d.destinationId, d.sourceFilter, d.facilities ? JSON.stringify(d.facilities) : null, d.maxSeverity)
      return { id: Number(r.lastInsertRowid), ...d }
    },
    deleteRoute: (id) => db.prepare('DELETE FROM routes WHERE id=?').run(id).changes > 0,
    getConfig() {
      return { inputs: this.listInputs(), destinations: this.listDestinations(), routes: this.listRoutes() }
    },
    getPasswordHash: () => getSetting('password_hash'),
    setPasswordHash: (h) => setSetting('password_hash', h),
    getAppliedHash: () => getSetting('applied_hash'),
    setAppliedHash: (h) => setSetting('applied_hash', h),
  }
}
