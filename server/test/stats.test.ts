import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeTestApp } from './auth.test.js'

let app: FastifyInstance
beforeEach(() => { app = makeTestApp() })

async function login(a: FastifyInstance): Promise<string> {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
  return r.cookies[0].value
}

describe('stats', () => {
  it('未登入存取 403/401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stats/overview' })
    expect(r.statusCode).toBe(401)
  })
  it('登入後取得現況快照與 tail（無 tailRing 時為空陣列）', async () => {
    const tok = await login(app)
    const r = await app.inject({ method: 'GET', url: '/api/stats/overview', cookies: { fanout_session: tok } })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ inputs: {}, actions: {}, sources: [], tail: [] })
  })
})
