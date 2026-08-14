import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ok, fail } from '../lib/envelope.js'

const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export function makeSessions() {
  const store = new Map<string, number>()
  return {
    create(): string {
      const tok = randomBytes(32).toString('hex')
      store.set(tok, Date.now() + SESSION_TTL_MS)
      return tok
    },
    valid: (tok: string) => (store.get(tok) ?? 0) > Date.now(),
    destroy: (tok: string) => void store.delete(tok),
  }
}
export type Sessions = ReturnType<typeof makeSessions>

const PasswordSchema = z.object({ password: z.string().min(8).max(128) })

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ password: z.string() }).safeParse(req.body)
    const hash = app.deps.repo.getPasswordHash()
    if (!body.success || !hash || !bcrypt.compareSync(body.data.password, hash))
      return reply.code(401).send(fail('PASSWORD_INCORRECT'))
    const tok = app.sessions.create()
    reply.setCookie('fanout_session', tok, { httpOnly: true, sameSite: 'strict', path: '/' })
    return ok({ loggedIn: true })
  })
  app.post('/api/auth/logout', async (req) => {
    const tok = req.cookies['fanout_session']
    if (tok) app.sessions.destroy(tok)
    return ok({ loggedIn: false })
  })
  app.put('/api/auth/password', async (req, reply) => {
    const body = PasswordSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send(fail('PASSWORD_LENGTH'))
    app.deps.repo.setPasswordHash(bcrypt.hashSync(body.data.password, 10))
    return ok({ changed: true })
  })
}
