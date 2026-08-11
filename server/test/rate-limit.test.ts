import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { makeTestApp } from './auth.test.js'

// index.ts 的正式組裝路徑：buildApp() 之後才 register(@fastify/static) + setNotFoundHandler，
// 兩者都掛在跟 app.ts 的全域 rateLimit 相同的 fastify instance 上——Bug 2（靜態資源被誤算進
// 60 req/min 額度）就是發生在這個組裝路徑，而不是 buildApp() 本身。makeTestApp() 只呼叫
// buildApp()，不會重現這條路徑；因此這裡另建一個鏡射 index.ts 組裝順序的 harness，
// 讓測試真的會踩到 bug 原本所在的位置（reviewer 指出的問題：先前的測試對 allowList
// 還原也會通過，因為根本沒有註冊 fastifyStatic/setNotFoundHandler）。
const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

async function makeIndexLikeApp(): Promise<FastifyInstance> {
  const app = makeTestApp()
  const webRoot = mkdtempSync(join(tmpdir(), 'fanout-webdist-'))
  tmpDirs.push(webRoot)
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log("stub")')
  writeFileSync(join(webRoot, 'index.html'), '<html></html>')
  await app.register(fastifyStatic, { root: webRoot })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ success: false, data: null, error: 'not found' })
    return reply.sendFile('index.html')
  })
  await app.ready()
  return app
}

describe('全域速率限制只套用在 /api/*（鏡射 index.ts 的組裝路徑：buildApp() + @fastify/static + setNotFoundHandler）', () => {
  it('靜態資源（真的透過 @fastify/static 服務）連打 70 次，0 個 429', async () => {
    const app = await makeIndexLikeApp()
    const statuses: number[] = []
    for (let i = 0; i < 70; i++) {
      const r = await app.inject({ method: 'GET', url: '/assets/app.js' })
      statuses.push(r.statusCode)
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(0)
    expect(statuses.every((s) => s === 200)).toBe(true)
  })

  it('SPA fallback（setNotFoundHandler 送 index.html）連打 70 次，0 個 429', async () => {
    const app = await makeIndexLikeApp()
    const statuses: number[] = []
    for (let i = 0; i < 70; i++) {
      const r = await app.inject({ method: 'GET', url: '/forwarding' })
      statuses.push(r.statusCode)
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(0)
  })

  it('/api/* 仍受全域速率限制保護（登入後對一般 API 端點連打）', async () => {
    const app = await makeIndexLikeApp()
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
