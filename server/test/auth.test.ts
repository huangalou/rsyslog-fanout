import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db.js'
import { createRepo } from '../src/domain/repo.js'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { applyConfig } from '../src/rsyslog/apply.js'
import type { FastifyInstance } from 'fastify'

export function makeTestApp(): FastifyInstance {
  const repo = createRepo(openDb(':memory:'))
  repo.setPasswordHash(bcrypt.hashSync('secret', 10))
  const dir = mkdtempSync(join(tmpdir(), 'fanout-test-'))
  const paths = { staging: join(dir, 's.conf'), live: join(dir, 'l.conf'), backup: join(dir, 'b.conf') }
  return buildApp({
    repo, env: loadEnv({ FANOUT_ADMIN_PASSWORD: 'secret', FANOUT_DATA_DIR: '/tmp/fanout-test' }),
    apply: () =>
      applyConfig({
        repo,
        paths,
        genOpts: { tailPort: 15514, dataDir: '/tmp/fanout-test' },
        validate: async () => ({ ok: true, output: '' }),
        restart: async () => ({ ok: true, output: '' }),
      }),
    monitor: { snapshot: () => ({ inputs: {}, actions: {}, sources: [] }), onStats: () => () => {}, onTail: () => () => {} },
  })
}

let app: FastifyInstance
beforeEach(() => { app = makeTestApp() })

async function login(a: FastifyInstance): Promise<string> {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
  return r.cookies[0].value
}

describe('auth', () => {
  it('正確密碼登入取得 cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
    expect(r.statusCode).toBe(200)
    expect(r.cookies[0].name).toBe('fanout_session')
    expect(r.cookies[0].httpOnly).toBe(true)
  })
  it('錯誤密碼 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' } })
    expect(r.statusCode).toBe(401)
  })
  it('未登入存取 API 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/inputs' })
    expect(r.statusCode).toBe(401)
  })
  it('登入後可改密碼並以新密碼登入', async () => {
    const tok = await login(app)
    const r = await app.inject({ method: 'PUT', url: '/api/auth/password', payload: { password: 'newpw12345' }, cookies: { fanout_session: tok } })
    expect(r.statusCode).toBe(200)
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'newpw12345' } })
    expect(r2.statusCode).toBe(200)
  })
  it('logout 後 session 失效', async () => {
    const tok = await login(app)
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { fanout_session: tok } })
    const r = await app.inject({ method: 'GET', url: '/api/inputs', cookies: { fanout_session: tok } })
    expect(r.statusCode).toBe(401)
  })
})

describe('bootstrap', () => {
  it('repo 無 password_hash 時，首次啟動以 FANOUT_ADMIN_PASSWORD 寫入，可直接登入', async () => {
    const repo = createRepo(openDb(':memory:'))
    expect(repo.getPasswordHash()).toBeNull()
    const bootstrapApp = buildApp({
      repo, env: loadEnv({ FANOUT_ADMIN_PASSWORD: 'bootstrap-pw', FANOUT_DATA_DIR: '/tmp/fanout-test' }),
      apply: async () => ({ applied: true }),
      monitor: { snapshot: () => ({ inputs: {}, actions: {}, sources: [] }), onStats: () => () => {}, onTail: () => () => {} },
    })
    expect(repo.getPasswordHash()).not.toBeNull()
    const r = await bootstrapApp.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'bootstrap-pw' } })
    expect(r.statusCode).toBe(200)
  })
  it('repo 已有 password_hash 時，不覆蓋既有密碼', async () => {
    const repo = createRepo(openDb(':memory:'))
    repo.setPasswordHash(bcrypt.hashSync('existing-pw', 10))
    buildApp({
      repo, env: loadEnv({ FANOUT_ADMIN_PASSWORD: 'bootstrap-pw', FANOUT_DATA_DIR: '/tmp/fanout-test' }),
      apply: async () => ({ applied: true }),
      monitor: { snapshot: () => ({ inputs: {}, actions: {}, sources: [] }), onStats: () => () => {}, onTail: () => () => {} },
    })
    expect(bcrypt.compareSync('existing-pw', repo.getPasswordHash()!)).toBe(true)
  })
})
