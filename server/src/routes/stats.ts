import type { FastifyInstance } from 'fastify'
import { ok } from '../lib/envelope.js'

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats/overview', async () => {
    const { monitor } = app.deps
    return ok({ ...monitor.snapshot(), tail: app.deps.tailRing?.() ?? [] })
  })
}
