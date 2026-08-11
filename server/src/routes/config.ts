import type { FastifyInstance } from 'fastify'
import { ok, fail } from '../lib/envelope.js'
import { configHash } from '../rsyslog/generate.js'
import type { ApplyResult } from '../rsyslog/apply.js'

let lastResult: ApplyResult | null = null

export async function configRoutes(app: FastifyInstance) {
  app.post('/api/config/apply', async () => {
    lastResult = await app.deps.apply()
    return lastResult.applied ? ok(lastResult) : { success: false, data: lastResult, error: lastResult.error }
  })
  app.get('/api/config/status', async () => {
    const { repo } = app.deps
    const dirty = configHash(repo.getConfig()) !== repo.getAppliedHash()
    return ok({ dirty, lastResult })
  })
}
