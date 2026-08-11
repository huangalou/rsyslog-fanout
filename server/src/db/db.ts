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

export function openDb(path: string): Database {
  const db = new DatabaseCtor(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
export type { Database }
