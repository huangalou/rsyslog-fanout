# Phase 2：後端 API 與監控（Tasks 6-10）

> 前置：完成 [01-backend-foundation.md](01-backend-foundation.md)。指令都在 `server/` 執行。

### Task 6: env 解析 + Fastify app 工廠 + auth 路由

**Files:**
- Create: `server/src/env.ts`, `server/src/app.ts`, `server/src/routes/auth.ts`
- Test: `server/test/env.test.ts`, `server/test/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 envelope、Task 3 `Repo`。
- Produces：

```ts
// env.ts
parsePortRange(s: string): number[]           // '514,5140-5199' → [514,5140,...,5199]；格式錯丟 Error
loadEnv(env: NodeJS.ProcessEnv): AppEnv
interface AppEnv { portRange: number[]; adminPassword: string; dataDir: string; httpPort: number; tailPort: number; rsyslogdBin: string }
// app.ts
buildApp(deps: AppDeps): FastifyInstance
interface AppDeps { repo: Repo; env: AppEnv; apply: () => Promise<ApplyResult>; monitor: MonitorHub }
// MonitorHub 於 Task 8/9 實作；Task 6 先定義介面（見 Task 8 Interfaces），app.ts 以型別引用。
// auth 行為：POST /api/auth/login {password} → 200 設 session cookie（httpOnly, sameSite=strict）；
// 錯誤密碼 401；rate limit 5 次/分。首次啟動若 repo 無 password_hash，bootstrap 以 FANOUT_ADMIN_PASSWORD bcrypt 寫入。
// authGuard preHandler：非 /api/auth/login 且無有效 session → 401。session 存於記憶體 Map<token, expiry>，token 為 32 bytes hex。
```

- [ ] **Step 1: 寫失敗測試**

`server/test/env.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parsePortRange, loadEnv } from '../src/env.js'

describe('parsePortRange', () => {
  it('混合單埠與範圍', () => {
    const r = parsePortRange('514,5140-5142')
    expect(r).toEqual([514, 5140, 5141, 5142])
  })
  it('格式錯誤丟 Error', () => expect(() => parsePortRange('abc')).toThrow())
  it('反向範圍丟 Error', () => expect(() => parsePortRange('5199-5140')).toThrow())
})

describe('loadEnv', () => {
  it('缺 FANOUT_ADMIN_PASSWORD 丟 Error', () => expect(() => loadEnv({})).toThrow(/FANOUT_ADMIN_PASSWORD/))
  it('預設值正確', () => {
    const e = loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw' })
    expect(e.httpPort).toBe(8080)
    expect(e.tailPort).toBe(15514)
    expect(e.dataDir).toBe('/data')
    expect(e.portRange).toContain(514)
  })
})
```

`server/test/auth.test.ts`（用 `app.inject()`，不開真埠；`makeTestApp()` helper 之後測試共用）：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { openDb } from '../src/db/db.js'
import { createRepo } from '../src/domain/repo.js'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import type { FastifyInstance } from 'fastify'

export function makeTestApp(): FastifyInstance {
  const repo = createRepo(openDb(':memory:'))
  repo.setPasswordHash(bcrypt.hashSync('secret', 10))
  return buildApp({
    repo, env: loadEnv({ FANOUT_ADMIN_PASSWORD: 'secret', FANOUT_DATA_DIR: '/tmp/fanout-test' }),
    apply: async () => ({ applied: true }),
    monitor: { snapshot: () => ({ inputs: {}, actions: {}, sources: [] }), onStats: () => () => {}, onTail: () => () => {} },
  })
}

let app: FastifyInstance
beforeEach(() => { app = makeTestApp() })

async function login(a: FastifyInstance): Promise<string> {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
  return r.cookies[0].value
}

describe('auth', () => {
  it('正確密碼登入取得 cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
    expect(r.statusCode).toBe(200)
    expect(r.cookies[0].name).toBe('fanout_session')
    expect(r.cookies[0].httpOnly).toBe(true)
  })
  it('錯誤密碼 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' } })
    expect(r.statusCode).toBe(401)
  })
  it('未登入存取 API 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/inputs' })
    expect(r.statusCode).toBe(401)
  })
  it('登入後可改密碼並以新密碼登入', async () => {
    const tok = await login(app)
    const r = await app.inject({ method: 'PUT', url: '/api/auth/password', payload: { password: 'newpw12345' }, cookies: { fanout_session: tok } })
    expect(r.statusCode).toBe(200)
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'newpw12345' } })
    expect(r2.statusCode).toBe(200)
  })
  it('logout 後 session 失效', async () => {
    const tok = await login(app)
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { fanout_session: tok } })
    const r = await app.inject({ method: 'GET', url: '/api/inputs', cookies: { fanout_session: tok } })
    expect(r.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: 執行確認失敗**——`npx vitest run test/env.test.ts test/auth.test.ts`。

- [ ] **Step 3: 實作 env.ts**

```ts
export interface AppEnv {
  portRange: number[]; adminPassword: string; dataDir: string
  httpPort: number; tailPort: number; rsyslogdBin: string
}

export function parsePortRange(s: string): number[] {
  const out: number[] = []
  for (const part of s.split(',').map((p) => p.trim())) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) throw new Error(`FANOUT_PORT_RANGE 格式錯誤: ${part}`)
    const lo = Number(m[1]); const hi = m[2] ? Number(m[2]) : lo
    if (lo > hi || hi > 65535) throw new Error(`FANOUT_PORT_RANGE 範圍錯誤: ${part}`)
    for (let p = lo; p <= hi; p++) out.push(p)
  }
  return out
}

export function loadEnv(env: NodeJS.ProcessEnv): AppEnv {
  if (!env.FANOUT_ADMIN_PASSWORD) throw new Error('FANOUT_ADMIN_PASSWORD 未設定')
  return {
    portRange: parsePortRange(env.FANOUT_PORT_RANGE ?? '514,5140-5199'),
    adminPassword: env.FANOUT_ADMIN_PASSWORD,
    dataDir: env.FANOUT_DATA_DIR ?? '/data',
    httpPort: Number(env.FANOUT_HTTP_PORT ?? 8080),
    tailPort: Number(env.FANOUT_TAIL_PORT ?? 15514),
    rsyslogdBin: env.RSYSLOGD_BIN ?? 'rsyslogd',
  }
}
```

- [ ] **Step 4: 實作 app.ts 與 routes/auth.ts**

`server/src/app.ts`：

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { Repo } from './domain/repo.js'
import type { AppEnv } from './env.js'
import type { ApplyResult } from './rsyslog/apply.js'
import type { MonitorHub } from './monitor/hub.js'
import { fail } from './lib/envelope.js'
import { authRoutes, makeSessions } from './routes/auth.js'
import { crudRoutes } from './routes/crud.js'
import { configRoutes } from './routes/config.js'
import { statsRoutes } from './routes/stats.js'

export interface AppDeps {
  repo: Repo; env: AppEnv
  apply: () => Promise<ApplyResult>
  monitor: MonitorHub
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify()
  const sessions = makeSessions()
  app.register(cookie)
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' })
  app.decorate('deps', deps)
  app.decorate('sessions', sessions)

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/api/auth/login' || req.url === '/api/health' || !req.url.startsWith('/api/')) return
    const tok = req.cookies['fanout_session']
    if (!tok || !sessions.valid(tok)) return reply.code(401).send(fail('未登入'))
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.register(authRoutes)
  app.register(crudRoutes)
  app.register(configRoutes)
  app.register(statsRoutes)
  return app
}
```

`server/src/routes/auth.ts`：

```ts
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
      return reply.code(401).send(fail('密碼錯誤'))
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
    if (!body.success) return reply.code(400).send(fail('密碼長度需 8-128 字元'))
    app.deps.repo.setPasswordHash(bcrypt.hashSync(body.data.password, 10))
    return ok({ changed: true })
  })
}
```

型別擴充 `server/src/types.d.ts`（讓 `app.deps`/`app.sessions` 通過 strict 檢查）：

```ts
import type { AppDeps } from './app.js'
import type { Sessions } from './routes/auth.js'
declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps; sessions: Sessions }
}
```

注意：此時 `crud.ts`/`config.ts`/`stats.ts`/`monitor/hub.ts` 尚未存在，先建立空殼讓編譯通過（`export async function crudRoutes() {}` 形式與 `hub.ts` 只放 `MonitorHub` 介面定義，見 Task 8 Interfaces），Task 7/8 再填實作——auth 測試不依賴它們（`/api/inputs` 401 由 preHandler 擋下，路由不存在也回 401 前置攔截）。

- [ ] **Step 5: 測試通過後 commit**

```bash
npx vitest run
git add server && git commit -m "feat: env 解析、app 工廠與單一管理帳號認證"
```

---

### Task 7: CRUD API + config API

**Files:**
- Create: `server/src/routes/crud.ts`, `server/src/routes/config.ts`
- Test: `server/test/crud.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas、Task 3 Repo、Task 5 `ApplyResult`、Task 6 `makeTestApp`。
- Produces（前端依賴的 API 形狀）：
  - `GET/POST /api/inputs`、`PUT/DELETE /api/inputs/:id`（destinations 同形；routes 僅 GET/POST/DELETE）
  - POST input 時埠號必須在 `env.portRange` 內且未被其他 input 佔用（同埠不同協定允許）
  - `POST /api/config/apply` → `ok(ApplyResult)` 或套用失敗時 `200` 帶 `fail(error)`＋`data` 含 stage
  - `GET /api/config/status` → `ok({ dirty: boolean, lastResult: ApplyResult | null })`；dirty = `configHash(repo.getConfig()) !== repo.getAppliedHash()`

- [ ] **Step 1: 寫失敗測試**

`server/test/crud.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeTestApp } from './auth.test.js'

let app: FastifyInstance, cookie: Record<string, string>
beforeEach(async () => {
  app = makeTestApp()
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
  cookie = { fanout_session: r.cookies[0].value }
})

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload, cookies: cookie })

describe('inputs CRUD', () => {
  it('建立→列出→更新→刪除', async () => {
    const c = await post('/api/inputs', { name: 'n1', protocol: 'udp', port: 514, enabled: true })
    expect(c.statusCode).toBe(200)
    const id = c.json().data.id
    expect((await app.inject({ url: '/api/inputs', cookies: cookie })).json().data).toHaveLength(1)
    const u = await app.inject({ method: 'PUT', url: `/api/inputs/${id}`, payload: { name: 'n2', protocol: 'udp', port: 514, enabled: false }, cookies: cookie })
    expect(u.json().data.name).toBe('n2')
    const d = await app.inject({ method: 'DELETE', url: `/api/inputs/${id}`, cookies: cookie })
    expect(d.statusCode).toBe(200)
  })
  it('埠號不在允許範圍 → 400 與明確錯誤', async () => {
    const r = await post('/api/inputs', { name: 'n', protocol: 'udp', port: 9999, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toContain('允許範圍')
  })
  it('同協定同埠重複 → 400', async () => {
    await post('/api/inputs', { name: 'a', protocol: 'udp', port: 514, enabled: true })
    const r = await post('/api/inputs', { name: 'b', protocol: 'udp', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
  })
  it('zod 驗證失敗 → 400 envelope', async () => {
    const r = await post('/api/inputs', { name: '', protocol: 'x', port: 514, enabled: true })
    expect(r.statusCode).toBe(400)
    expect(r.json().success).toBe(false)
  })
})

describe('routes + config', () => {
  it('route 指向不存在的 input → 400', async () => {
    const r = await post('/api/routes', { inputId: 999, destinationId: 999, sourceFilter: null, facilities: null, maxSeverity: null })
    expect(r.statusCode).toBe(400)
  })
  it('config status：初始 dirty、apply 後乾淨', async () => {
    await post('/api/inputs', { name: 'n', protocol: 'udp', port: 514, enabled: true })
    let s = await app.inject({ url: '/api/config/status', cookies: cookie })
    expect(s.json().data.dirty).toBe(true)
    await post('/api/config/apply', {})
    s = await app.inject({ url: '/api/config/status', cookies: cookie })
    expect(s.json().data.dirty).toBe(false)
  })
})
```

註：`makeTestApp` 的 `apply` 假函式需改為「呼叫真 `applyConfig` 但 validate/restart 為成功假件、paths 指向暫存目錄」，讓 appliedHash 真的更新——修改 `auth.test.ts` 的 helper（引用 Task 5 `applyConfig`），保持單一 helper 給所有 API 測試共用。

- [ ] **Step 2: 執行確認失敗**——`npx vitest run test/crud.test.ts`。

- [ ] **Step 3: 實作**

`server/src/routes/crud.ts`（三實體共用一個工廠，DRY）：

```ts
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
```

`server/src/routes/config.ts`：

```ts
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
```

（`lastResult` 為模組層變數即可——單程序單管理者；重啟後歸 null 屬可接受行為。）

- [ ] **Step 4: 測試通過**——`npx vitest run`。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: inputs/destinations/routes CRUD 與設定套用 API"`

---

### Task 8: impstats 解析 + MonitorHub

**Files:**
- Create: `server/src/monitor/hub.ts`, `server/src/monitor/impstats.ts`
- Test: `server/test/impstats.test.ts`

**Interfaces:**
- Produces：

```ts
// hub.ts —— 監控資料的單一匯流排（Task 6 的空殼在此補完整）
interface StatsSnapshot {
  inputs: Record<string, { submitted: number; rate: number }>        // key: 'udp:514'
  actions: Record<string, { processed: number; failed: number; suspended: boolean; queueSize: number }>  // key: 'd1_i1'
  sources: Array<{ ip: string; lastSeen: number; stale: boolean }>
}
interface MonitorHub {
  snapshot(): StatsSnapshot
  onStats(cb: (s: StatsSnapshot) => void): () => void     // 回傳取消訂閱
  onTail(cb: (line: TailMsg) => void): () => void
}
// impstats.ts
parseImpstatsLine(line: string): ImpstatsEntry | null
interface ImpstatsEntry { name: string; origin: string; values: Record<string, number> }
createImpstatsReader(path: string, hub: HubInternals, intervalMs?: number): { start(): void; stop(): void }
// reader 記住檔案 offset，每 intervalMs（預設 10000）讀新增行；rate = (本次 submitted - 上次)/interval 秒
```

- [ ] **Step 1: 寫失敗測試**

`server/test/impstats.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseImpstatsLine, applyEntries } from '../src/monitor/impstats.js'
import { createHub } from '../src/monitor/hub.js'

const inputLine = '{ "name": "imudp(*:514)", "origin": "imudp", "submitted": 100 }'
const actionLine = '{ "name": "d1_i1", "origin": "core.action", "processed": 90, "failed": 2, "suspended": 1 }'
const queueLine = '{ "name": "d1_i1 queue", "origin": "core.queue", "size": 5 }'

describe('parseImpstatsLine', () => {
  it('解析 imudp 統計', () => {
    expect(parseImpstatsLine(inputLine)).toEqual({ name: 'imudp(*:514)', origin: 'imudp', values: { submitted: 100 } })
  })
  it('非 JSON 行回 null', () => expect(parseImpstatsLine('not json')).toBeNull())
})

describe('applyEntries → snapshot', () => {
  it('input/action/queue 統計整合進 snapshot，rate 依差值計算', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    applyEntries(hub, [inputLine, actionLine, queueLine].map((l) => parseImpstatsLine(l)!), 10)
    applyEntries(hub, [parseImpstatsLine('{ "name": "imudp(*:514)", "origin": "imudp", "submitted": 150 }')!], 10)
    const s = hub.snapshot()
    expect(s.inputs['udp:514'].submitted).toBe(150)
    expect(s.inputs['udp:514'].rate).toBe(5)          // (150-100)/10s
    expect(s.actions['d1_i1']).toEqual({ processed: 90, failed: 2, suspended: true, queueSize: 5 })
  })
  it('snapshot 更新時通知 onStats 訂閱者', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    let called = 0
    const off = hub.onStats(() => called++)
    applyEntries(hub, [parseImpstatsLine(inputLine)!], 10)
    expect(called).toBe(1)
    off()
    applyEntries(hub, [parseImpstatsLine(inputLine)!], 10)
    expect(called).toBe(1)
  })
})
```

- [ ] **Step 2: 執行確認失敗**。

- [ ] **Step 3: 實作**

`server/src/monitor/hub.ts`：

```ts
export interface TailMsg { src: string; input: number; fac: number; sev: number; msg: string; ts: number }
export interface StatsSnapshot {
  inputs: Record<string, { submitted: number; rate: number }>
  actions: Record<string, { processed: number; failed: number; suspended: boolean; queueSize: number }>
  sources: Array<{ ip: string; lastSeen: number; stale: boolean }>
}
export interface MonitorHub {
  snapshot(): StatsSnapshot
  onStats(cb: (s: StatsSnapshot) => void): () => void
  onTail(cb: (m: TailMsg) => void): () => void
}
export interface HubInternals extends MonitorHub {
  setInput(key: string, submitted: number, rate: number): void
  setAction(key: string, v: { processed: number; failed: number; suspended: boolean; queueSize: number }): void
  seenSource(ip: string, ts: number): void
  emitStats(): void
  emitTail(m: TailMsg): void
}

export function createHub(opts: { staleAfterMs: number }): HubInternals {
  const inputs: StatsSnapshot['inputs'] = {}
  const actions: StatsSnapshot['actions'] = {}
  const sources = new Map<string, number>()
  const statsSubs = new Set<(s: StatsSnapshot) => void>()
  const tailSubs = new Set<(m: TailMsg) => void>()
  const snapshot = (): StatsSnapshot => ({
    inputs: { ...inputs }, actions: { ...actions },
    sources: [...sources.entries()].map(([ip, lastSeen]) => ({ ip, lastSeen, stale: Date.now() - lastSeen > opts.staleAfterMs })),
  })
  return {
    snapshot,
    onStats: (cb) => (statsSubs.add(cb), () => statsSubs.delete(cb)),
    onTail: (cb) => (tailSubs.add(cb), () => tailSubs.delete(cb)),
    setInput: (k, submitted, rate) => void (inputs[k] = { submitted, rate }),
    setAction: (k, v) => void (actions[k] = v),
    seenSource: (ip, ts) => void sources.set(ip, ts),
    emitStats: () => statsSubs.forEach((cb) => cb(snapshot())),
    emitTail: (m) => tailSubs.forEach((cb) => cb(m)),
  }
}
```

`server/src/monitor/impstats.ts`：

```ts
import { readFileSync, statSync } from 'node:fs'
import type { HubInternals } from './hub.js'

export interface ImpstatsEntry { name: string; origin: string; values: Record<string, number> }

export function parseImpstatsLine(line: string): ImpstatsEntry | null {
  try {
    const o = JSON.parse(line)
    if (typeof o.name !== 'string' || typeof o.origin !== 'string') return null
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') values[k] = v
    return { name: o.name, origin: o.origin, values }
  } catch { return null }
}

const prevSubmitted = new Map<string, number>()
const IMUDP_RE = /^im(udp|tcp)\(\*:(\d+)\)$/

export function applyEntries(hub: HubInternals, entries: ImpstatsEntry[], intervalSec: number): void {
  const queueSizes = new Map<string, number>()
  for (const e of entries) {
    if (e.origin === 'core.queue') queueSizes.set(e.name.replace(/ queue$/, ''), e.values.size ?? 0)
  }
  for (const e of entries) {
    const m = IMUDP_RE.exec(e.name)
    if (m) {
      const key = `${m[1]}:${m[2]}`
      const prev = prevSubmitted.get(key)
      const submitted = e.values.submitted ?? 0
      const rate = prev === undefined ? 0 : Math.max(0, (submitted - prev) / intervalSec)
      prevSubmitted.set(key, submitted)
      hub.setInput(key, submitted, rate)
    } else if (e.origin === 'core.action') {
      hub.setAction(e.name, {
        processed: e.values.processed ?? 0, failed: e.values.failed ?? 0,
        suspended: (e.values.suspended ?? 0) > 0, queueSize: queueSizes.get(e.name) ?? 0,
      })
    }
  }
  hub.emitStats()
}

export function createImpstatsReader(path: string, hub: HubInternals, intervalMs = 10000) {
  let offset = 0
  let timer: NodeJS.Timeout | null = null
  const tick = () => {
    try {
      const size = statSync(path).size
      if (size < offset) offset = 0            // 檔案被 rotate/truncate
      if (size === offset) return
      const text = readFileSync(path, 'utf8').slice(offset)
      offset = size
      const entries = text.split('\n').map(parseImpstatsLine).filter((e): e is ImpstatsEntry => e !== null)
      if (entries.length) applyEntries(hub, entries, intervalMs / 1000)
    } catch { /* 檔案尚未存在：rsyslog 未啟動前屬正常，靜默略過 */ }
  }
  return { start: () => { timer = setInterval(tick, intervalMs); tick() }, stop: () => { if (timer) clearInterval(timer) } }
}
```

（注意 `prevSubmitted` 為模組層 Map，測試檔內兩次 `applyEntries` 共享——測試通過的關鍵；多 hub 場景不存在，單程序唯一 reader。）

- [ ] **Step 4: 測試通過**——`npx vitest run`。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: impstats 解析與 MonitorHub"`

---

### Task 9: tail listener（UDP）+ 限流 + 來源健康

**Files:**
- Create: `server/src/monitor/tail.ts`
- Test: `server/test/tail.test.ts`

**Interfaces:**
- Consumes: Task 8 `HubInternals`、`TailMsg`。
- Produces：

```ts
createTailListener(hub: HubInternals, opts: { port: number; ringSize?: number; maxPerSec?: number }): {
  start(): Promise<void>; stop(): void; ring(): TailMsg[]
}
// 行為：UDP bind 127.0.0.1:port；每包 JSON.parse 成 TailMsg（加 ts=Date.now()）；
// token bucket 每秒 maxPerSec（預設 500），超出丟棄不入 ring 不 emit；
// ring 環形緩衝預設 1000 則；每則有效訊息呼叫 hub.seenSource(src, ts) 與 hub.emitTail(msg)。
// handleDatagram(buf) 抽成可直接測試的函式（不經網路）。
```

- [ ] **Step 1: 寫失敗測試**

`server/test/tail.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { createTailListener } from '../src/monitor/tail.js'
import { createHub } from '../src/monitor/hub.js'

const pkt = (i: number) => Buffer.from(JSON.stringify({ src: '10.0.0.9', input: 1, fac: 16, sev: 6, msg: `m${i}` }))

describe('tail listener', () => {
  it('datagram 解析後進 ring、emitTail、更新來源', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const seen: string[] = []
    hub.onTail((m) => seen.push(m.msg))
    const t = createTailListener(hub, { port: 0, ringSize: 3 })
    t.handleDatagram(pkt(1))
    expect(seen).toEqual(['m1'])
    expect(hub.snapshot().sources[0].ip).toBe('10.0.0.9')
  })
  it('ring 超過容量丟最舊', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const t = createTailListener(hub, { port: 0, ringSize: 3 })
    for (let i = 1; i <= 5; i++) t.handleDatagram(pkt(i))
    expect(t.ring().map((m) => m.msg)).toEqual(['m3', 'm4', 'm5'])
  })
  it('超過每秒上限的訊息被丟棄', () => {
    vi.useFakeTimers()
    const hub = createHub({ staleAfterMs: 600000 })
    const t = createTailListener(hub, { port: 0, ringSize: 10, maxPerSec: 2 })
    for (let i = 1; i <= 5; i++) t.handleDatagram(pkt(i))
    expect(t.ring()).toHaveLength(2)
    vi.advanceTimersByTime(1000)
    t.handleDatagram(pkt(6))
    expect(t.ring()).toHaveLength(3)
    vi.useRealTimers()
  })
  it('壞 JSON 靜默丟棄', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const t = createTailListener(hub, { port: 0 })
    t.handleDatagram(Buffer.from('garbage'))
    expect(t.ring()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 執行確認失敗**。

- [ ] **Step 3: 實作**

`server/src/monitor/tail.ts`：

```ts
import { createSocket } from 'node:dgram'
import type { HubInternals, TailMsg } from './hub.js'

export function createTailListener(hub: HubInternals, opts: { port: number; ringSize?: number; maxPerSec?: number }) {
  const ringSize = opts.ringSize ?? 1000
  const maxPerSec = opts.maxPerSec ?? 500
  const ring: TailMsg[] = []
  let windowStart = 0
  let windowCount = 0
  const sock = createSocket('udp4')

  function handleDatagram(buf: Buffer): void {
    const now = Date.now()
    if (now - windowStart >= 1000) { windowStart = now; windowCount = 0 }
    if (windowCount >= maxPerSec) return
    let parsed: unknown
    try { parsed = JSON.parse(buf.toString('utf8')) } catch { return }
    const p = parsed as Record<string, unknown>
    if (typeof p.src !== 'string' || typeof p.msg !== 'string') return
    windowCount++
    const m: TailMsg = { src: p.src, input: Number(p.input), fac: Number(p.fac), sev: Number(p.sev), msg: p.msg, ts: now }
    ring.push(m)
    if (ring.length > ringSize) ring.shift()
    hub.seenSource(m.src, now)
    hub.emitTail(m)
  }

  sock.on('message', handleDatagram)
  return {
    handleDatagram,
    ring: () => [...ring],
    start: () => new Promise<void>((res) => sock.bind(opts.port, '127.0.0.1', res)),
    stop: () => sock.close(),
  }
}
```

- [ ] **Step 4: 測試通過**——`npx vitest run`。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: live tail UDP listener 與來源健康追蹤"`

---

### Task 10: stats API + WebSocket + bootstrap

**Files:**
- Create: `server/src/routes/stats.ts`, `server/src/routes/ws.ts`, `server/src/index.ts`
- Test: `server/test/ws.test.ts`

**Interfaces:**
- Consumes: 前面全部。
- Produces（前端依賴）：
  - `GET /api/stats/overview` → `ok(StatsSnapshot & { tail: TailMsg[] })`（tail 為 ring 現值）
  - `WS /api/ws`（需已登入之 cookie）；伺服器推播訊息格式：`{ ch: 'stats', data: StatsSnapshot }` 與 `{ ch: 'tail', data: TailMsg }`
  - `index.ts`：組裝真實依賴（openDb→repo、首次寫入密碼 hash、mkdir /data 子目錄、createHub、impstats reader、tail listener、真 validate/restart、@fastify/static 服務 `web/dist`、SPA fallback 到 index.html）

- [ ] **Step 1: 寫失敗測試**

`server/test/ws.test.ts`（用 `app.inject` 的 WS 支援不穩，改開真埠 + `ws` 客戶端；`npm i -D ws @types/ws`）：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { makeTestApp } from './auth.test.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
afterEach(() => app?.close())

describe('ws', () => {
  it('登入後可連線並收到 stats 推播', async () => {
    app = makeTestApp()
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret' } })
    const cookie = `fanout_session=${login.cookies[0].value}`
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { cookie } })
    const first = await new Promise<any>((res, rej) => {
      ws.on('message', (d) => res(JSON.parse(d.toString())))
      ws.on('error', rej)
    })
    expect(first.ch).toBe('stats')      // 連線時立即推一次現況
    ws.close()
  })
  it('未帶 cookie 連線被拒', async () => {
    app = makeTestApp()
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
    const code = await new Promise<number>((res) => ws.on('close', (c) => res(c)))
    expect(code).not.toBe(1000)
  })
})
```

- [ ] **Step 2: 執行確認失敗**。

- [ ] **Step 3: 實作**

`server/src/routes/stats.ts`：

```ts
import type { FastifyInstance } from 'fastify'
import { ok } from '../lib/envelope.js'

export async function statsRoutes(app: FastifyInstance) {
  app.get('/api/stats/overview', async () => {
    const { monitor } = app.deps
    return ok({ ...monitor.snapshot(), tail: app.deps.tailRing?.() ?? [] })
  })
}
```

（`AppDeps` 增加可選欄位 `tailRing?: () => TailMsg[]`——修改 `app.ts` 的介面並在 `makeTestApp` 略過。）

`server/src/routes/ws.ts`（在 `app.ts` 內 `app.register(wsRoutes)`，並於 buildApp 的 preHandler 放行由 ws 自行驗證的升級請求；@fastify/websocket 走一般 route，preHandler 會先跑，401 即拒）：

```ts
import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'

export async function wsRoutes(app: FastifyInstance) {
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
```

`server/src/index.ts`：

```ts
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
```

- [ ] **Step 4: 測試通過 + 覆蓋率檢查**——`npx vitest run --coverage`，各檔 ≥80%（`index.ts` 屬組裝碼，加入 coverage exclude 清單：`vitest.config.ts` 的 `coverage.exclude: ['src/index.ts']`）。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: stats API、WebSocket 推播與服務組裝"`

Phase 2 完成，接續 [03-frontend.md](03-frontend.md)。
