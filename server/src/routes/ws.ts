import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket)
  app.get('/api/ws', { websocket: true }, (conn) => {
    const { monitor } = app.deps
    const send = (o: unknown) => { if (conn.readyState === conn.OPEN) conn.send(JSON.stringify(o)) }
    send({ ch: 'stats', data: monitor.snapshot() })
    const offStats = monitor.onStats((s) => send({ ch: 'stats', data: s }))
    const offTail = monitor.onTail((m) => send({ ch: 'tail', data: m }))
    conn.on('close', () => { offStats(); offTail() })
  })
}
