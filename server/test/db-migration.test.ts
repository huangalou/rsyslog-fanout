import { describe, it, expect, afterAll } from 'vitest'
import DatabaseCtor from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db.js'

const tmpDirs: string[] = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

// 重現 v1.0.0 無唯一索引的舊 schema + 實際發生過的重複資料（e2e-dest x4），
// 驗證 openDb 的 migration 會去重並保住既有路由
function makeLegacyDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fanout-mig-'))
  tmpDirs.push(dir)
  const path = join(dir, 'legacy.db')
  const db = new DatabaseCtor(path)
  db.exec(`
    CREATE TABLE inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
      port INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
      host TEXT NOT NULL, port INTEGER NOT NULL,
      header_mode TEXT NOT NULL DEFAULT 'raw' CHECK(header_mode IN ('raw','standard')),
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_id INTEGER NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      source_filter TEXT, facilities TEXT, max_severity INTEGER
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO inputs (name, protocol, port) VALUES ('in-a', 'udp', 5150), ('in-b', 'udp', 514);
    INSERT INTO destinations (name, protocol, host, port) VALUES
      ('e2e-dest', 'udp', 'h', 19999), ('e2e-dest', 'udp', 'h', 19999),
      ('e2e-dest', 'udp', 'h', 19999), ('other', 'udp', 'h', 19998);
    INSERT INTO routes (input_id, destination_id) VALUES (1, 1), (2, 2), (2, 4);
  `)
  db.close()
  return path
}

describe('openDb migration：既有 DB 去重後建唯一索引', () => {
  it('同名 destination 去重保留最小 id，指向重複者的 route 重新對應且不遺失', () => {
    const db = openDb(makeLegacyDb())
    const dests = db.prepare('SELECT id, name FROM destinations ORDER BY id').all() as Array<{ id: number; name: string }>
    expect(dests.map((d) => d.name)).toEqual(['e2e-dest', 'other'])
    const routes = db.prepare('SELECT input_id, destination_id FROM routes ORDER BY input_id, destination_id').all() as Array<{ input_id: number; destination_id: number }>
    // route (2,2) 原指向重複的 e2e-dest(id=2) → 改指向保留的 id=1；(1,1) 與 (2,4) 不動
    expect(routes).toEqual([
      { input_id: 1, destination_id: 1 },
      { input_id: 2, destination_id: 1 },
      { input_id: 2, destination_id: 4 },
    ])
    db.close()
  })
  it('migration 後重複名稱/路由於 DB 層被唯一索引擋下', () => {
    const db = openDb(makeLegacyDb())
    expect(() => db.prepare("INSERT INTO destinations (name, protocol, host, port) VALUES ('other', 'udp', 'x', 1)").run()).toThrow()
    expect(() => db.prepare('INSERT INTO routes (input_id, destination_id) VALUES (1, 1)').run()).toThrow()
    db.close()
  })
  it('migration 具冪等性：對已遷移的 DB 重複開啟不變動資料', () => {
    const path = makeLegacyDb()
    openDb(path).close()
    const db = openDb(path)
    expect((db.prepare('SELECT COUNT(*) AS c FROM destinations').get() as { c: number }).c).toBe(2)
    expect((db.prepare('SELECT COUNT(*) AS c FROM routes').get() as { c: number }).c).toBe(3)
    db.close()
  })
})

describe('openDb migration：同埠不同名的重複 input', () => {
  it('route 指向 proto/port 去重的落選者時重新指向保留者，不得沉默遺失', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fanout-mig2-'))
    tmpDirs.push(dir)
    const path = join(dir, 'legacy2.db')
    const raw = new DatabaseCtor(path)
    raw.exec(`
      CREATE TABLE inputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
        port INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE destinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
        host TEXT NOT NULL, port INTEGER NOT NULL,
        header_mode TEXT NOT NULL DEFAULT 'raw' CHECK(header_mode IN ('raw','standard')),
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        input_id INTEGER NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
        destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
        source_filter TEXT, facilities TEXT, max_severity INTEGER
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO inputs (name, protocol, port) VALUES ('udpA', 'udp', 514), ('udpB', 'udp', 514);
      INSERT INTO destinations (name, protocol, host, port) VALUES ('dest', 'udp', 'h', 19999);
      INSERT INTO routes (input_id, destination_id) VALUES (2, 1);
    `)
    raw.close()
    const db = openDb(path)
    const inputs = db.prepare('SELECT id, name FROM inputs').all() as Array<{ id: number; name: string }>
    expect(inputs).toEqual([{ id: 1, name: 'udpA' }])
    const routes = db.prepare('SELECT input_id, destination_id FROM routes').all() as Array<{ input_id: number; destination_id: number }>
    expect(routes).toEqual([{ input_id: 1, destination_id: 1 }])  // 重新指向保留的 id=1，而非被 CASCADE 刪除
    db.close()
  })
})
