import type { FastifyInstance } from 'fastify'
import { ok, fail } from '../lib/envelope.js'
import { configHash } from '../rsyslog/generate.js'
import type { ApplyResult } from '../rsyslog/apply.js'

let lastResult: ApplyResult | null = null

export async function configRoutes(app: FastifyInstance) {
  app.post('/api/config/apply', async () => {
    lastResult = await app.deps.apply()
    if (lastResult.applied) return ok(lastResult)
    if (lastResult.stage === 'precheck') return fail(lastResult.code, { dir: app.deps.env.tlsDir })
    return fail('APPLY_FAILED', undefined, lastResult.error)
  })
  app.get('/api/config/status', async () => {
    const { repo } = app.deps
    const dirty = configHash(repo.getConfig()) !== repo.getAppliedHash()
    return ok({ dirty, lastResult })
  })
}
