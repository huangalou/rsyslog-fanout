import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import bcrypt from 'bcryptjs'
import type { Repo } from './domain/repo.js'
import type { AppEnv } from './env.js'
import type { ApplyResult } from './rsyslog/apply.js'
import type { MonitorHub } from './monitor/hub.js'
import { fail } from './lib/envelope.js'
import { authRoutes, makeSessions } from './routes/auth.js'
import { crudRoutes } from './routes/crud.js'
import { configRoutes } from './routes/config.js'
import { statsRoutes } from './routes/stats.js'

export interface AppDeps {
  repo: Repo; env: AppEnv
  apply: () => Promise<ApplyResult>
  monitor: MonitorHub
}

export function buildApp(deps: AppDeps): FastifyInstance {
  if (!deps.repo.getPasswordHash()) {
    deps.repo.setPasswordHash(bcrypt.hashSync(deps.env.adminPassword, 10))
  }

  const app = Fastify()
  const sessions = makeSessions()
  app.register(cookie)
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' })
  app.decorate('deps', deps)
  app.decorate('sessions', sessions)

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/api/auth/login' || req.url === '/api/health' || !req.url.startsWith('/api/')) return
    const tok = req.cookies['fanout_session']
    if (!tok || !sessions.valid(tok)) return reply.code(401).send(fail('未登入'))
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.register(authRoutes)
  app.register(crudRoutes)
  app.register(configRoutes)
  app.register(statsRoutes)
  return app
}
