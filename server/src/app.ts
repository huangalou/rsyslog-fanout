import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import bcrypt from 'bcryptjs'
import type { Repo } from './domain/repo.js'
import type { AppEnv } from './env.js'
import type { ApplyResult } from './rsyslog/apply.js'
import type { MonitorHub, TailMsg } from './monitor/hub.js'
import { fail } from './lib/envelope.js'
import { constraintToErrorCode } from './lib/sqlite-errors.js'
import { authRoutes, makeSessions } from './routes/auth.js'
import { crudRoutes } from './routes/crud.js'
import { configRoutes } from './routes/config.js'
import { statsRoutes } from './routes/stats.js'
import { wsRoutes } from './routes/ws.js'

export interface AppDeps {
  repo: Repo; env: AppEnv
  apply: () => Promise<ApplyResult>
  monitor: MonitorHub
  tailRing?: () => TailMsg[]
}

export function buildApp(deps: AppDeps): FastifyInstance {
  if (!deps.repo.getPasswordHash()) {
    deps.repo.setPasswordHash(bcrypt.hashSync(deps.env.adminPassword, 10))
  }

  const app = Fastify()
  const sessions = makeSessions()
  app.register(cookie)
  // 僅對 /api/* 套用全域速率限制：靜態資源（index.html、JS/CSS chunk、SPA fallback）
  // 與 rate-limit 掛在同一個 fastify instance 上，若不排除，SPA 每次整頁導覽
  // （非前端路由內部切換）都會重新拉整包資源，正常操作幾次就會把額度打完、
  // 出現 429（實機以 Playwright 導覽多個頁面時發現）。/api/* 本身仍受限，
  // 未削弱對登入等端點的保護。
  app.register(rateLimit, { max: 60, timeWindow: '1 minute', allowList: (req) => !req.url.startsWith('/api/') })
  app.decorate('deps', deps)
  app.decorate('sessions', sessions)

  // 未捕捉例外的最後防線：唯一索引違反（handler 檢查與寫入間的併發窗口）
  // 映射為契約錯誤碼；其他例外一律回通用 500，不把內部錯誤內容洩漏給 client。
  app.setErrorHandler((err, _req, reply) => {
    const code = constraintToErrorCode(err)
    if (code) return reply.code(400).send(fail(code))
    if ((err as { statusCode?: number }).statusCode === 429) return reply.send(err)  // rate-limit 原样回應
    console.error(err)
    return reply.code(500).send(fail('INTERNAL'))
  })

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/api/auth/login' || req.url === '/api/health' || !req.url.startsWith('/api/')) return
    const tok = req.cookies['fanout_session']
    if (!tok || !sessions.valid(tok)) return reply.code(401).send(fail('UNAUTHENTICATED'))
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.register(authRoutes)
  app.register(crudRoutes)
  app.register(configRoutes)
  app.register(statsRoutes)
  app.register(wsRoutes)
  return app
}
