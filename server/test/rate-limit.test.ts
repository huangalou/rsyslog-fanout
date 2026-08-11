import { describe, it, expect } from 'vitest'
import { makeTestApp } from './auth.test.js'

describe('全域速率限制只套用在 /api/*', () => {
  it('非 /api/ 路徑（靜態資源／SPA fallback）不受全域速率限制影響', async () => {
    const app = makeTestApp()
    let sawNon429 = 0
    for (let i = 0; i < 70; i++) {
      const r = await app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(r.statusCode).not.toBe(429)
      sawNon429++
    }
    expect(sawNon429).toBe(70)
  })

  it('/api/* 仍受全域速率限制保護（登入後對一般 API 端點連打）', async () => {
    const app = makeTestApp()
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
    const tok = login.cookies[0].value
    const statuses: number[] = []
    for (let i = 0; i < 70; i++) {
      const r = await app.inject({ method: 'GET', url: '/api/inputs', cookies: { fanout_session: tok } })
      statuses.push(r.statusCode)
    }
    expect(statuses).toContain(429)
  })
})
