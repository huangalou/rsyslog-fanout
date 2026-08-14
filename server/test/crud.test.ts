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
  it('埠號不在允許範圍 → 400、錯誤碼 PORT_OUT_OF_RANGE 帶 params', async () => {
    const r = await post('/api/inputs', { name: 'n', protocol: 'udp', port: 9999, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('PORT_OUT_OF_RANGE')
    expect(r.json().error.params.port).toBe(9999)
    expect(r.json().error.message).toContain('9999')
  })
  it('同協定同埠重複 → 400、錯誤碼 PORT_IN_USE', async () => {
    await post('/api/inputs', { name: 'a', protocol: 'udp', port: 514, enabled: true })
    const r = await post('/api/inputs', { name: 'b', protocol: 'udp', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('PORT_IN_USE')
  })
  it('zod 驗證失敗 → 400、錯誤碼 VALIDATION 帶 zod 訊息', async () => {
    const r = await post('/api/inputs', { name: '', protocol: 'x', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().success).toBe(false)
    expect(r.json().error.code).toBe('VALIDATION')
    expect(typeof r.json().error.message).toBe('string')
  })
  it('刪除不存在資源 → 404、錯誤碼 NOT_FOUND', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/inputs/999', cookies: cookie })
    expect(r.statusCode).toBe(404)
    expect(r.json().error.code).toBe('NOT_FOUND')
  })
})

describe('destinations CRUD', () => {
  it('建立→列出→更新（headerMode）→刪除', async () => {
    const c = await post('/api/destinations', { name: 'd1', protocol: 'udp', host: '10.0.0.1', port: 514, enabled: true })
    expect(c.statusCode).toBe(200)
    expect(c.json().data.headerMode).toBe('raw')
    const id = c.json().data.id
    expect((await app.inject({ url: '/api/destinations', cookies: cookie })).json().data).toHaveLength(1)
    const u = await app.inject({
      method: 'PUT', url: `/api/destinations/${id}`,
      payload: { name: 'd2', protocol: 'udp', host: '10.0.0.1', port: 514, headerMode: 'standard', enabled: false },
      cookies: cookie,
    })
    expect(u.statusCode).toBe(200)
    expect(u.json().data.headerMode).toBe('standard')
    const d = await app.inject({ method: 'DELETE', url: `/api/destinations/${id}`, cookies: cookie })
    expect(d.statusCode).toBe(200)
    expect((await app.inject({ url: '/api/destinations', cookies: cookie })).json().data).toHaveLength(0)
  })
})

describe('routes + config', () => {
  it('route 指向不存在的 input → 400', async () => {
    const r = await post('/api/routes', { inputId: 999, destinationId: 999, sourceFilter: null, facilities: null, maxSeverity: null })
    expect(r.statusCode).toBe(400)
  })
  it('route 成功建立並保真（sourceFilter/facilities/maxSeverity round-trip）→ 刪除', async () => {
    const i = await post('/api/inputs', { name: 'i1', protocol: 'udp', port: 514, enabled: true })
    const d = await post('/api/destinations', { name: 'd1', protocol: 'udp', host: '10.0.0.1', port: 514, enabled: true })
    const payload = {
      inputId: i.json().data.id, destinationId: d.json().data.id,
      sourceFilter: '10.1.0.0/16', facilities: [16, 17], maxSeverity: 4,
    }
    const r = await post('/api/routes', payload)
    expect(r.statusCode).toBe(200)
    expect(r.json().data).toMatchObject(payload)
    const id = r.json().data.id
    const list = await app.inject({ url: '/api/routes', cookies: cookie })
    expect(list.json().data).toContainEqual(r.json().data)
    const del = await app.inject({ method: 'DELETE', url: `/api/routes/${id}`, cookies: cookie })
    expect(del.statusCode).toBe(200)
    expect((await app.inject({ url: '/api/routes', cookies: cookie })).json().data).toHaveLength(0)
  })
  it('destination host 格式非法 → 400、錯誤碼 HOST_FORMAT', async () => {
    const r = await post('/api/destinations', { name: 'd', protocol: 'udp', host: 'bad host!', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('HOST_FORMAT')
  })
  it('route sourceFilter 非法 CIDR → 400、錯誤碼 SOURCE_FILTER_FORMAT', async () => {
    const r = await post('/api/routes', { inputId: 1, destinationId: 1, sourceFilter: '10.0.0.0/12', facilities: null, maxSeverity: null })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('SOURCE_FILTER_FORMAT')
  })
  it('apply 失敗 → 錯誤碼 APPLY_FAILED、message 帶 rsyslog 輸出', async () => {
    const failApp = makeTestApp({ validateOutput: 'syntax err on line 3' })
    const login = await failApp.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
    const failCookie = { fanout_session: login.cookies[0].value }
    await failApp.inject({ method: 'POST', url: '/api/inputs', payload: { name: 'n', protocol: 'udp', port: 514, enabled: true }, cookies: failCookie })
    const r = await failApp.inject({ method: 'POST', url: '/api/config/apply', payload: {}, cookies: failCookie })
    expect(r.json().success).toBe(false)
    expect(r.json().error.code).toBe('APPLY_FAILED')
    expect(r.json().error.message).toContain('syntax err on line 3')
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
