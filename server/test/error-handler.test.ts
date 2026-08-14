import { describe, it, expect } from 'vitest'
import { constraintToErrorCode } from '../src/lib/sqlite-errors.js'
import { makeTestApp } from './auth.test.js'

const sqliteErr = (message: string) => Object.assign(new Error(message), { code: 'SQLITE_CONSTRAINT_UNIQUE' })

describe('constraintToErrorCode：唯一索引違反映射為契約錯誤碼', () => {
  it('routes 唯一索引 → ROUTE_EXISTS', () => {
    expect(constraintToErrorCode(sqliteErr('UNIQUE constraint failed: routes.input_id, routes.destination_id'))).toBe('ROUTE_EXISTS')
  })
  it('inputs (protocol, port) 唯一索引 → PORT_IN_USE', () => {
    expect(constraintToErrorCode(sqliteErr('UNIQUE constraint failed: inputs.protocol, inputs.port'))).toBe('PORT_IN_USE')
  })
  it('名稱唯一索引 → NAME_IN_USE', () => {
    expect(constraintToErrorCode(sqliteErr('UNIQUE constraint failed: destinations.name'))).toBe('NAME_IN_USE')
    expect(constraintToErrorCode(sqliteErr('UNIQUE constraint failed: inputs.name'))).toBe('NAME_IN_USE')
  })
  it('非 unique-constraint 錯誤 → null', () => {
    expect(constraintToErrorCode(new Error('boom'))).toBe(null)
    expect(constraintToErrorCode(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(null)
  })
})

describe('app error handler：不洩漏內部錯誤', () => {
  it('handler 拋出 unique constraint 錯誤 → 400 契約錯誤碼，而非 500 原始訊息', async () => {
    const app = makeTestApp()
    app.get('/_test-constraint', async () => { throw sqliteErr('UNIQUE constraint failed: destinations.name') })
    const r = await app.inject({ url: '/_test-constraint' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('NAME_IN_USE')
  })
  it('handler 拋出其他例外 → 500 通用訊息，不洩漏原始錯誤內容', async () => {
    const app = makeTestApp()
    app.get('/_test-boom', async () => { throw new Error('secret internal detail') })
    const r = await app.inject({ url: '/_test-boom' })
    expect(r.statusCode).toBe(500)
    expect(r.json().error.code).toBe('INTERNAL')
    expect(JSON.stringify(r.json())).not.toContain('secret internal detail')
  })
})
