import type { FastifyInstance } from 'fastify'
import { ok, fail, isErrorCode } from '../lib/envelope.js'
import type { Envelope } from '../lib/envelope.js'
import { InputCreateSchema, DestinationCreateSchema, RouteCreateSchema } from '../domain/types.js'

// zod 自訂訊息若為穩定錯誤碼(domain/types.ts),直接以該碼回應讓前端翻譯;
// 其餘 zod 預設訊息以 VALIDATION 包英文原文。
const failValidation = (message: string): Envelope<never> =>
  isErrorCode(message) ? fail(message) : fail('VALIDATION', undefined, message)

// PUT 省略 TLS 欄位時沿用現值。TLS 欄位是後來才加的，不認得它們的呼叫方（舊腳本、舊版前端）
// 更新一筆 TLS 設定時若直接套 schema 預設值，會把 TLS 悄悄關掉並回 200。
// 沿用後仍走同一個 schema：例如把協定改成 udp 而現值有 TLS，會得到明確的 TLS_REQUIRES_TCP。
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const keepExisting = (body: unknown, existing: Record<string, unknown> | undefined): unknown =>
  isRecord(body) && existing ? { ...existing, ...body } : body

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
    if (repo.listInputs().some((i) => i.name === p.data.name))
      return reply.code(400).send(fail('NAME_IN_USE'))
    return ok(repo.createInput(p.data))
  })
  app.put<{ Params: { id: string } }>('/api/inputs/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const current = repo.listInputs().find((i) => i.id === id)
    const p = InputCreateSchema.safeParse(keepExisting(req.body, current && { tls: current.tls }))
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    if (!env.portRange.includes(p.data.port))
      return reply.code(400).send(fail('PORT_OUT_OF_RANGE', { port: p.data.port, range: portRangeLabel() }))
    if (repo.listInputs().some((i) => i.id !== id && i.port === p.data.port && i.protocol === p.data.protocol))
      return reply.code(400).send(fail('PORT_IN_USE'))
    if (repo.listInputs().some((i) => i.id !== id && i.name === p.data.name))
      return reply.code(400).send(fail('NAME_IN_USE'))
    const u = repo.updateInput(id, p.data)
    return u ? ok(u) : reply.code(404).send(fail('NOT_FOUND'))
  })
  app.delete<{ Params: { id: string } }>('/api/inputs/:id', async (req, reply) => {
    return repo.deleteInput(Number(req.params.id)) ? ok({ deleted: true }) : reply.code(404).send(fail('NOT_FOUND'))
  })

  app.get('/api/destinations', async () => ok(repo.listDestinations()))
  app.post('/api/destinations', async (req, reply) => {
    const p = DestinationCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    if (repo.listDestinations().some((d) => d.name === p.data.name))
      return reply.code(400).send(fail('NAME_IN_USE'))
    return ok(repo.createDestination(p.data))
  })
  app.put<{ Params: { id: string } }>('/api/destinations/:id', async (req, reply) => {
    const destId = Number(req.params.id)
    const current = repo.listDestinations().find((d) => d.id === destId)
    const p = DestinationCreateSchema.safeParse(
      keepExisting(req.body, current && { tlsMode: current.tlsMode, tlsPeerName: current.tlsPeerName }))
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    if (repo.listDestinations().some((d) => d.id !== destId && d.name === p.data.name))
      return reply.code(400).send(fail('NAME_IN_USE'))
    const u = repo.updateDestination(destId, p.data)
    return u ? ok(u) : reply.code(404).send(fail('NOT_FOUND'))
  })
  app.delete<{ Params: { id: string } }>('/api/destinations/:id', async (req, reply) => {
    return repo.deleteDestination(Number(req.params.id)) ? ok({ deleted: true }) : reply.code(404).send(fail('NOT_FOUND'))
  })

  app.get('/api/routes', async () => ok(repo.listRoutes()))
  app.post('/api/routes', async (req, reply) => {
    const p = RouteCreateSchema.safeParse(req.body)
    if (!p.success) return reply.code(400).send(failValidation(p.error.issues[0].message))
    if (!repo.listInputs().some((i) => i.id === p.data.inputId)) return reply.code(400).send(fail('INPUT_NOT_FOUND'))
    if (!repo.listDestinations().some((d) => d.id === p.data.destinationId)) return reply.code(400).send(fail('DESTINATION_NOT_FOUND'))
    if (repo.listRoutes().some((r) => r.inputId === p.data.inputId && r.destinationId === p.data.destinationId))
      return reply.code(400).send(fail('ROUTE_EXISTS'))
    return ok(repo.createRoute(p.data))
  })
  app.delete<{ Params: { id: string } }>('/api/routes/:id', async (req, reply) => {
    return repo.deleteRoute(Number(req.params.id)) ? ok({ deleted: true }) : reply.code(404).send(fail('NOT_FOUND'))
  })
}
