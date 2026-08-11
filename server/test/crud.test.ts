import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeTestApp } from './auth.test.js'

let app: FastifyInstance, cookie: Record<string, string>
beforeEach(async () => {
  app = makeTestApp()
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
  cookie = { fanout_session: r.cookies[0].value }
})

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload, cookies: cookie })

describe('inputs CRUD', () => {
  it('建立→列出→更新→刪除', async () => {
    const c = await post('/api/inputs', { name: 'n1', protocol: 'udp', port: 514, enabled: true })
    expect(c.statusCode).toBe(200)
    const id = c.json().data.id
    expect((await app.inject({ url: '/api/inputs', cookies: cookie })).json().data).toHaveLength(1)
    const u = await app.inject({ method: 'PUT', url: `/api/inputs/${id}`, payload: { name: 'n2', protocol: 'udp', port: 514, enabled: false }, cookies: cookie })
    expect(u.json().data.name).toBe('n2')
    const d = await app.inject({ method: 'DELETE', url: `/api/inputs/${id}`, cookies: cookie })
    expect(d.statusCode).toBe(200)
  })
  it('埠號不在允許範圍 → 400 與明確錯誤', async () => {
    const r = await post('/api/inputs', { name: 'n', protocol: 'udp', port: 9999, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toContain('允許範圍')
  })
  it('同協定同埠重複 → 400', async () => {
    await post('/api/inputs', { name: 'a', protocol: 'udp', port: 514, enabled: true })
    const r = await post('/api/inputs', { name: 'b', protocol: 'udp', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
  })
  it('zod 驗證失敗 → 400 envelope', async () => {
    const r = await post('/api/inputs', { name: '', protocol: 'x', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().success).toBe(false)
  })
})

describe('routes + config', () => {
  it('route 指向不存在的 input → 400', async () => {
    const r = await post('/api/routes', { inputId: 999, destinationId: 999, sourceFilter: null, facilities: null, maxSeverity: null })
    expect(r.statusCode).toBe(400)
  })
  it('config status：初始 dirty、apply 後乾淨', async () => {
    await post('/api/inputs', { name: 'n', protocol: 'udp', port: 514, enabled: true })
    let s = await app.inject({ url: '/api/config/status', cookies: cookie })
    expect(s.json().data.dirty).toBe(true)
    await post('/api/config/apply', {})
    s = await app.inject({ url: '/api/config/status', cookies: cookie })
    expect(s.json().data.dirty).toBe(false)
  })
})
