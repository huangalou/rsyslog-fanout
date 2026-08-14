import type { ErrorCode } from './envelope.js'

// handler 層先做過同樣的唯一性檢查（NAME_IN_USE / ROUTE_EXISTS / PORT_IN_USE），
// 這裡是併發 TOCTOU 窗口的 DB 層防線：唯一索引違反時把 better-sqlite3 的
// SqliteError 映射回契約錯誤碼，避免以 500 洩漏原始 SQL 訊息。
export function constraintToErrorCode(err: unknown): ErrorCode | null {
  if (!(err instanceof Error)) return null
  if ((err as { code?: string }).code !== 'SQLITE_CONSTRAINT_UNIQUE') return null
  if (err.message.includes('routes.')) return 'ROUTE_EXISTS'
  if (err.message.includes('inputs.protocol')) return 'PORT_IN_USE'
  return 'NAME_IN_USE'
}
