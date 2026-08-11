import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import bcrypt from 'bcryptjs'
import fastifyStatic from '@fastify/static'
import { loadEnv } from './env.js'
import { openDb } from './db/db.js'
import { createRepo } from './domain/repo.js'
import { buildApp } from './app.js'
import { applyConfig } from './rsyslog/apply.js'
import { createHub } from './monitor/hub.js'
import { createImpstatsReader } from './monitor/impstats.js'
import { createTailListener } from './monitor/tail.js'

const pExec = promisify(execFile)
const run = async (cmd: string, args: string[]) => {
  try { const r = await pExec(cmd, args); return { ok: true, output: r.stderr + r.stdout } }
  catch (e: any) { return { ok: false, output: String(e.stderr ?? e.message) } }
}

async function main() {
  const env = loadEnv(process.env)
  for (const d of ['rsyslog', 'queues', 'stats']) mkdirSync(join(env.dataDir, d), { recursive: true })
  const repo = createRepo(openDb(join(env.dataDir, 'fanout.db')))
  if (!repo.getPasswordHash()) repo.setPasswordHash(bcrypt.hashSync(env.adminPassword, 10))

  const hub = createHub({ staleAfterMs: Number(process.env.FANOUT_STALE_MINUTES ?? 10) * 60 * 1000 })
  const tail = createTailListener(hub, { port: env.tailPort })
  await tail.start()
  createImpstatsReader(join(env.dataDir, 'stats/impstats.json'), hub).start()

  const paths = {
    staging: join(env.dataDir, 'rsyslog/staging.conf'),
    live: join(env.dataDir, 'rsyslog/live.conf'),
    backup: join(env.dataDir, 'rsyslog/backup.conf'),
  }
  const restart = async () => {
    const r = await run('s6-svc', ['-r', '/run/service/rsyslogd'])
    if (!r.ok) return r
    await new Promise((res) => setTimeout(res, 5000))
    return run('s6-svstat', ['-o', 'up', '/run/service/rsyslogd'])
  }
  const app = buildApp({
    repo, env, monitor: hub, tailRing: tail.ring,
    apply: () => applyConfig({
      repo, paths, genOpts: { tailPort: env.tailPort, dataDir: env.dataDir },
      validate: (p) => run(env.rsyslogdBin, ['-N1', '-f', p]),
      restart,
    }),
  })
  await app.register(fastifyStatic, { root: join(import.meta.dirname, '../../web/dist') })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ success: false, data: null, error: 'not found' })
    return reply.sendFile('index.html')
  })
  await app.listen({ port: env.httpPort, host: '0.0.0.0' })
  console.log(`FanOut WebUI on :${env.httpPort}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
