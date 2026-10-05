import type { FastifyInstance } from 'fastify'
import { ok } from '../lib/envelope.js'
import { readTlsStatus } from '../rsyslog/tls.js'

export async function tlsRoutes(app: FastifyInstance): Promise<void> {
  // 只回報憑證的公開資訊與檔案是否就緒，供 WebUI 在啟用 TLS input 前提示；不回傳任何檔案內容
  app.get('/api/tls/status', async () => ok(readTlsStatus(app.deps.env.tlsDir)))
}
