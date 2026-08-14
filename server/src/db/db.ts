import DatabaseCtor from 'better-sqlite3'
import type { Database } from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
  port INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
  host TEXT NOT NULL, port INTEGER NOT NULL,
  header_mode TEXT NOT NULL DEFAULT 'raw' CHECK(header_mode IN ('raw','standard')),
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_id INTEGER NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  source_filter TEXT, facilities TEXT, max_severity INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

// v1.0.0 無唯一索引，既有 DB 可能已有重複資料（實例：dev 容器 e2e-dest x4）——
// 建索引前先去重：同名保留最小 id 並把 route 重新指向保留者，最後 route 本身去重。
// 全部語句冪等，重複開啟不變動資料。
const MIGRATE_DEDUPE = `
UPDATE routes SET destination_id = (
  SELECT MIN(d2.id) FROM destinations d2
  WHERE d2.name = (SELECT name FROM destinations d WHERE d.id = routes.destination_id)
);
DELETE FROM destinations WHERE id NOT IN (SELECT MIN(id) FROM destinations GROUP BY name);
UPDATE routes SET input_id = (
  SELECT MIN(i2.id) FROM inputs i2
  WHERE i2.name = (SELECT name FROM inputs i WHERE i.id = routes.input_id)
);
DELETE FROM inputs WHERE id NOT IN (SELECT MIN(id) FROM inputs GROUP BY name);
UPDATE routes SET input_id = (
  SELECT MIN(i2.id) FROM inputs i2
  WHERE i2.protocol = (SELECT protocol FROM inputs i WHERE i.id = routes.input_id)
    AND i2.port = (SELECT port FROM inputs i WHERE i.id = routes.input_id)
);
DELETE FROM inputs WHERE id NOT IN (SELECT MIN(id) FROM inputs GROUP BY protocol, port);
DELETE FROM routes WHERE id NOT IN (SELECT MIN(id) FROM routes GROUP BY input_id, destination_id);
`

const UNIQUE_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_inputs_name ON inputs(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inputs_proto_port ON inputs(protocol, port);
CREATE UNIQUE INDEX IF NOT EXISTS idx_destinations_name ON destinations(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_pair ON routes(input_id, destination_id);
`

export function openDb(path: string): Database {
  const db = new DatabaseCtor(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  // 去重 + 建索引以單一交易執行：中途被殺（如首次開機 OOM）整組回滾，
  // 不留下部分遷移的中間態
  db.transaction(() => {
    db.exec(MIGRATE_DEDUPE)
    db.exec(UNIQUE_INDEXES)
  })()
  return db
}
export type { Database }
