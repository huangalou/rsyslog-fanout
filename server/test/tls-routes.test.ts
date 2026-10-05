import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { makeTestApp } from './auth.test.js'

let app: FastifyInstance, cookie: Record<string, string>, tlsDir: string
beforeEach(async () => {
  tlsDir = mkdtempSync(join(tmpdir(), 'fanout-tls-routes-'))
  app = makeTestApp({ tlsDir })
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
  cookie = { fanout_session: r.cookies[0].value }
})
afterEach(() => { rmSync(tlsDir, { recursive: true, force: true }) })

const post = (url: string, payload?: unknown) => app.inject({ method: 'POST', url, payload, cookies: cookie })
const get = (url: string) => app.inject({ method: 'GET', url, cookies: cookie })
const mountCert = () => {
  copyFileSync('test/fixtures/tls/cert.pem', join(tlsDir, 'cert.pem'))
  writeFileSync(join(tlsDir, 'key.pem'), 'dummy-key')
}
const tlsInput = { name: 'tls-in', protocol: 'tcp', port: 5140, enabled: true, tls: true }

describe('GET /api/tls/status', () => {
  it('未登入 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tls/status' })).statusCode).toBe(401)
  })
  it('未掛憑證：回報未就緒與 TLS 目錄', async () => {
    const data = (await get('/api/tls/status')).json().data
    expect(data.dir).toBe(tlsDir)
    expect(data.customCa).toBe(false)
    expect(data.serverCert.ready).toBe(false)
  })
  it('已掛憑證：回報就緒與憑證主體', async () => {
    mountCert()
    const data = (await get('/api/tls/status')).json().data
    expect(data.serverCert).toMatchObject({ ready: true, subject: 'CN=fanout.test', expired: false })
  })
})

describe('TLS 欄位的 CRUD 驗證', () => {
  it('tcp input 啟用 tls：建立成功並可讀回', async () => {
    const r = await post('/api/inputs', tlsInput)
    expect(r.statusCode).toBe(200)
    expect(r.json().data.tls).toBe(true)
    expect((await get('/api/inputs')).json().data[0].tls).toBe(true)
  })
  it('未帶 tls 的舊式請求仍可建立 input，tls 為 false', async () => {
    const r = await post('/api/inputs', { name: 'old', protocol: 'udp', port: 514, enabled: true })
    expect(r.statusCode).toBe(200)
    expect(r.json().data.tls).toBe(false)
  })
  it('udp input 啟用 tls → 400、錯誤碼 TLS_REQUIRES_TCP', async () => {
    const r = await post('/api/inputs', { ...tlsInput, protocol: 'udp' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('TLS_REQUIRES_TCP')
  })
  it('更新 input 為 udp + tls → 400、錯誤碼 TLS_REQUIRES_TCP', async () => {
    const id = (await post('/api/inputs', tlsInput)).json().data.id
    const r = await app.inject({ method: 'PUT', url: `/api/inputs/${id}`, payload: { ...tlsInput, protocol: 'udp' }, cookies: cookie })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('TLS_REQUIRES_TCP')
  })
  it('destination 設 verify 與 tlsPeerName：建立成功並可讀回', async () => {
    const r = await post('/api/destinations', { name: 'siem', protocol: 'tcp', host: '10.0.0.5', port: 6514, enabled: true, tlsMode: 'verify', tlsPeerName: 'siem.example.com' })
    expect(r.statusCode).toBe(200)
    expect(r.json().data).toMatchObject({ tlsMode: 'verify', tlsPeerName: 'siem.example.com' })
  })
  it('udp destination 設 tlsMode → 400、錯誤碼 TLS_REQUIRES_TCP', async () => {
    const r = await post('/api/destinations', { name: 'siem', protocol: 'udp', host: '10.0.0.5', port: 6514, enabled: true, tlsMode: 'anon' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('TLS_REQUIRES_TCP')
  })
  it('tlsPeerName 含引號 → 400、錯誤碼 TLS_PEER_NAME_FORMAT', async () => {
    const r = await post('/api/destinations', { name: 'siem', protocol: 'tcp', host: '10.0.0.5', port: 6514, enabled: true, tlsMode: 'verify', tlsPeerName: 'a" x="1' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('TLS_PEER_NAME_FORMAT')
  })
})

describe('套用：TLS 憑證檢查', () => {
  it('有 TLS input 但未掛憑證 → 錯誤碼 TLS_CERT_MISSING，params 帶 TLS 目錄', async () => {
    await post('/api/inputs', tlsInput)
    const r = await post('/api/config/apply')
    expect(r.json().success).toBe(false)
    expect(r.json().error.code).toBe('TLS_CERT_MISSING')
    expect(r.json().error.params.dir).toBe(tlsDir)
    expect(r.json().error.message).toContain(tlsDir)
    expect((await get('/api/config/status')).json().data.dirty).toBe(true)
  })
  it('掛上憑證後套用成功', async () => {
    await post('/api/inputs', tlsInput)
    mountCert()
    const r = await post('/api/config/apply')
    expect(r.json().success).toBe(true)
    expect((await get('/api/config/status')).json().data.dirty).toBe(false)
  })
})
