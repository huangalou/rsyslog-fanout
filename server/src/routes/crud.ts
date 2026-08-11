import type { FastifyInstance } from 'fastify'
import { ok, fail } from '../lib/envelope.js'
import { InputCreateSchema, DestinationCreateSchema, RouteCreateSchema } from '../domain/types.js'

export async function crudRoutes(app: FastifyInstance) {
  const { repo, env } = app.deps

  app.get('/api/inputs', async () => ok(repo.listInputs()))
  app.post('/api/inputs', async (req, reply) => {
    const p = InputCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(fail(p.error.issues[0].message))
    if (!env.portRange.includes(p.data.port))
      return reply.code(400).send(fail(`埠號 ${p.data.port} 不在允許範圍（FANOUT_PORT_RANGE=${env.portRange[0]}...）`))
    if (repo.listInputs().some((i) => i.port === p.data.port && i.protocol === p.data.protocol))
      return reply.code(400).send(fail('同協定之埠號已被使用'))
    return ok(repo.createInput(p.data))
  })
  app.put('/api/inputs/:id', async (req, reply) => {
    const p = InputCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(fail(p.error.issues[0].message))
    const id = Number((req.params as any).id)
    if (!env.portRange.includes(p.data.port))
      return reply.code(400).send(fail('埠號不在允許範圍'))
    if (repo.listInputs().some((i) => i.id !== id && i.port === p.data.port && i.protocol === p.data.protocol))
      return reply.code(400).send(fail('同協定之埠號已被使用'))
    const u = repo.updateInput(id, p.data)
    return u ? ok(u) : reply.code(404).send(fail('找不到資源'))
  })
  app.delete('/api/inputs/:id', async (req, reply) => {
    return repo.deleteInput(Number((req.params as any).id)) ? ok({ deleted: true }) : reply.code(404).send(fail('找不到資源'))
  })

  app.get('/api/destinations', async () => ok(repo.listDestinations()))
  app.post('/api/destinations', async (req, reply) => {
    const p = DestinationCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(fail(p.error.issues[0].message))
    return ok(repo.createDestination(p.data))
  })
  app.put('/api/destinations/:id', async (req, reply) => {
    const p = DestinationCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(fail(p.error.issues[0].message))
    const u = repo.updateDestination(Number((req.params as any).id), p.data)
    return u ? ok(u) : reply.code(404).send(fail('找不到資源'))
  })
  app.delete('/api/destinations/:id', async (req, reply) => {
    return repo.deleteDestination(Number((req.params as any).id)) ? ok({ deleted: true }) : reply.code(404).send(fail('找不到資源'))
  })

  app.get('/api/routes', async () => ok(repo.listRoutes()))
  app.post('/api/routes', async (req, reply) => {
    const p = RouteCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(fail(p.error.issues[0].message))
    if (!repo.listInputs().some((i) => i.id === p.data.inputId)) return reply.code(400).send(fail('input 不存在'))
    if (!repo.listDestinations().some((d) => d.id === p.data.destinationId)) return reply.code(400).send(fail('destination 不存在'))
    return ok(repo.createRoute(p.data))
  })
  app.delete('/api/routes/:id', async (req, reply) => {
    return repo.deleteRoute(Number((req.params as any).id)) ? ok({ deleted: true }) : reply.code(404).send(fail('找不到資源'))
  })
}
