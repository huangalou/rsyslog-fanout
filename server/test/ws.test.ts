import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { makeTestApp } from './auth.test.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
afterEach(() => app?.close())

describe('ws', () => {
  it('登入後可連線並收到 stats 推播', async () => {
    app = makeTestApp()
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
    const cookie = `fanout_session=${login.cookies[0].value}`
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { cookie } })
    const first = await new Promise<any>((res, rej) => {
      ws.on('message', (d) => res(JSON.parse(d.toString())))
      ws.on('error', rej)
    })
    expect(first.ch).toBe('stats')      // 連線時立即推一次現況
    ws.close()
  })
  it('未帶 cookie 連線被拒', async () => {
    app = makeTestApp()
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
    ws.on('error', () => {}) // 401 拒絕升級時 ws 會先觸發 error，未監聽會變成未捕捉例外
    const code = await new Promise<number>((res) => ws.on('close', (c) => res(c)))
    expect(code).not.toBe(1000)
  })
})
