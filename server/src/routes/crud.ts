import type { FastifyInstance } from 'fastify'
import { ok, fail, isErrorCode } from '../lib/envelope.js'
import type { Envelope } from '../lib/envelope.js'
import { InputCreateSchema, DestinationCreateSchema, RouteCreateSchema } from '../domain/types.js'

// zod 自訂訊息若為穩定錯誤碼(domain/types.ts),直接以該碼回應讓前端翻譯;
// 其餘 zod 預設訊息以 VALIDATION 包英文原文。
const failValidation = (message: string): Envelope<never> =>
  isErrorCode(message) ? fail(message) : fail('VALIDATION', undefined, message)

export async function crudRoutes(app: FastifyInstance) {
  const { repo, env } = app.deps
  const portRangeLabel = () => `FANOUT_PORT_RANGE=${env.portRange[0]}...`

  app.get('/api/inputs', async () => ok(repo.listInputs()))
  app.post('/api/inputs', async (req, reply) => {
    const p = InputCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    if (!env.portRange.includes(p.data.port))
      return reply.code(400).send(fail('PORT_OUT_OF_RANGE', { port: p.data.port, range: portRangeLabel() }))
    if (repo.listInputs().some((i) => i.port === p.data.port && i.protocol === p.data.protocol))
      return reply.code(400).send(fail('PORT_IN_USE'))
    return ok(repo.createInput(p.data))
  })
  app.put('/api/inputs/:id', async (req, reply) => {
    const p = InputCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    const id = Number((req.params as any).id)
    if (!env.portRange.includes(p.data.port))
      return reply.code(400).send(fail('PORT_OUT_OF_RANGE', { port: p.data.port, range: portRangeLabel() }))
    if (repo.listInputs().some((i) => i.id !== id && i.port === p.data.port && i.protocol === p.data.protocol))
      return reply.code(400).send(fail('PORT_IN_USE'))
    const u = repo.updateInput(id, p.data)
    return u ? ok(u) : reply.code(404).send(fail('NOT_FOUND'))
  })
  app.delete('/api/inputs/:id', async (req, reply) => {
    return repo.deleteInput(Number((req.params as any).id)) ? ok({ deleted: true }) : reply.code(404).send(fail('NOT_FOUND'))
  })

  app.get('/api/destinations', async () => ok(repo.listDestinations()))
  app.post('/api/destinations', async (req, reply) => {
    const p = DestinationCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    return ok(repo.createDestination(p.data))
  })
  app.put('/api/destinations/:id', async (req, reply) => {
    const p = DestinationCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    const u = repo.updateDestination(Number((req.params as any).id), p.data)
    return u ? ok(u) : reply.code(404).send(fail('NOT_FOUND'))
  })
  app.delete('/api/destinations/:id', async (req, reply) => {
    return repo.deleteDestination(Number((req.params as any).id)) ? ok({ deleted: true }) : reply.code(404).send(fail('NOT_FOUND'))
  })

  app.get('/api/routes', async () => ok(repo.listRoutes()))
  app.post('/api/routes', async (req, reply) => {
    const p = RouteCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    if (!repo.listInputs().some((i) => i.id === p.data.inputId)) return reply.code(400).send(fail('INPUT_NOT_FOUND'))
    if (!repo.listDestinations().some((d) => d.id === p.data.destinationId)) return reply.code(400).send(fail('DESTINATION_NOT_FOUND'))
    return ok(repo.createRoute(p.data))
  })
  app.delete('/api/routes/:id', async (req, reply) => {
    return repo.deleteRoute(Number((req.params as any).id)) ? ok({ deleted: true }) : reply.code(404).send(fail('NOT_FOUND'))
  })
}
