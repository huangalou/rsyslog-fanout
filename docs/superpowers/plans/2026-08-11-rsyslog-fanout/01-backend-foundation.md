# Phase 1：後端基礎（Tasks 1-5）

> 前置：閱讀 [00-overview.md](00-overview.md) 的 Global Constraints 與檔案結構。所有指令在 `server/` 目錄執行（Task 1 建立它）。

### Task 1: server 鷹架 + envelope helper

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/lib/envelope.ts`
- Test: `server/test/envelope.test.ts`

**Interfaces:**
- Produces: `ok<T>(data: T): Envelope<T>`、`fail(error: string): Envelope<never>`、`type Envelope<T> = { success: boolean; data: T | null; error: string | null }` — 之後所有 route 回應都用這兩個函式。

- [ ] **Step 1: 建立套件與設定檔**

`server/package.json`：

```json
{
  "name": "rsyslog-fanout-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

安裝依賴：

```bash
mkdir -p server/src/lib server/test && cd server
npm i fastify @fastify/cookie @fastify/websocket @fastify/static @fastify/rate-limit better-sqlite3 zod bcryptjs
npm i -D typescript tsx vitest @vitest/coverage-v8 @types/node @types/better-sqlite3 @types/bcryptjs
```

`server/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "outDir": "dist", "rootDir": "src",
    "esModuleInterop": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```

`server/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { coverage: { provider: 'v8', thresholds: { lines: 80, functions: 80, branches: 80 } } },
})
```

- [ ] **Step 2: 寫失敗測試**

`server/test/envelope.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { ok, fail } from '../src/lib/envelope.js'

describe('envelope', () => {
  it('ok 包裝資料且 error 為 null', () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 }, error: null })
  })
  it('fail 帶錯誤訊息且 data 為 null', () => {
    expect(fail('bad')).toEqual({ success: false, data: null, error: 'bad' })
  })
})
```

- [ ] **Step 3: 執行測試確認失敗**——`npx vitest run`，預期：Cannot find module `envelope.js`。

- [ ] **Step 4: 最小實作**

`server/src/lib/envelope.ts`：

```ts
export interface Envelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

export const ok = <T>(data: T): Envelope<T> => ({ success: true, data, error: null })
export const fail = (error: string): Envelope<never> => ({ success: false, data: null, error })
```

- [ ] **Step 5: 測試通過後 commit**

```bash
npx vitest run   # 預期 2 passed
git add server && git commit -m "feat: server 鷹架與 envelope helper"
```

---

### Task 2: domain 型別 + zod schemas

**Files:**
- Create: `server/src/domain/types.ts`
- Test: `server/test/types.test.ts`

**Interfaces:**
- Produces（後續所有任務依賴的核心型別；zod schema 供 API 驗證）：

```ts
type Protocol = 'udp' | 'tcp'
type HeaderMode = 'raw' | 'standard'
interface Input { id: number; name: string; protocol: Protocol; port: number; enabled: boolean }
interface Destination { id: number; name: string; protocol: Protocol; host: string; port: number; headerMode: HeaderMode; enabled: boolean }
interface RouteRule { id: number; inputId: number; destinationId: number; sourceFilter: string | null; facilities: number[] | null; maxSeverity: number | null }
interface FanoutConfig { inputs: Input[]; destinations: Destination[]; routes: RouteRule[] }
// zod: InputCreateSchema, DestinationCreateSchema, RouteCreateSchema（create 用，不含 id）
// cidrToPrefix(s: string): string | null —— '10.1.2.0/24' → '10.1.2.'；完整 IP 原樣回傳；不支援的遮罩回 null
```

- [ ] **Step 1: 寫失敗測試**

`server/test/types.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { InputCreateSchema, DestinationCreateSchema, RouteCreateSchema, cidrToPrefix } from '../src/domain/types.js'

describe('cidrToPrefix', () => {
  it('完整 IP 原樣回傳', () => expect(cidrToPrefix('10.1.2.3')).toBe('10.1.2.3'))
  it('/24 轉三段前綴', () => expect(cidrToPrefix('10.1.2.0/24')).toBe('10.1.2.'))
  it('/16 轉兩段前綴', () => expect(cidrToPrefix('10.1.0.0/16')).toBe('10.1.'))
  it('/8 轉一段前綴', () => expect(cidrToPrefix('10.0.0.0/8')).toBe('10.'))
  it('不支援的遮罩回 null', () => expect(cidrToPrefix('10.0.0.0/12')).toBeNull())
  it('非 IP 回 null', () => expect(cidrToPrefix('abc')).toBeNull())
})

describe('schemas', () => {
  it('合法 input 通過', () => {
    expect(InputCreateSchema.safeParse({ name: 'n1', protocol: 'udp', port: 514, enabled: true }).success).toBe(true)
  })
  it('埠號超界拒絕', () => {
    expect(InputCreateSchema.safeParse({ name: 'n1', protocol: 'udp', port: 70000, enabled: true }).success).toBe(false)
  })
  it('destination 預設 headerMode=raw', () => {
    const r = DestinationCreateSchema.parse({ name: 'd', protocol: 'udp', host: '10.0.0.5', port: 514, enabled: true })
    expect(r.headerMode).toBe('raw')
  })
  it('route 的 sourceFilter 遮罩不支援時拒絕', () => {
    const r = RouteCreateSchema.safeParse({ inputId: 1, destinationId: 1, sourceFilter: '10.0.0.0/12', facilities: null, maxSeverity: null })
    expect(r.success).toBe(false)
  })
  it('facility 超出 0-23 拒絕', () => {
    const r = RouteCreateSchema.safeParse({ inputId: 1, destinationId: 1, sourceFilter: null, facilities: [24], maxSeverity: null })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: 執行確認失敗**——`npx vitest run test/types.test.ts`，預期模組不存在。

- [ ] **Step 3: 實作**

`server/src/domain/types.ts`：

```ts
import { z } from 'zod'

export type Protocol = 'udp' | 'tcp'
export type HeaderMode = 'raw' | 'standard'

export interface Input { id: number; name: string; protocol: Protocol; port: number; enabled: boolean }
export interface Destination {
  id: number; name: string; protocol: Protocol; host: string; port: number
  headerMode: HeaderMode; enabled: boolean
}
export interface RouteRule {
  id: number; inputId: number; destinationId: number
  sourceFilter: string | null; facilities: number[] | null; maxSeverity: number | null
}
export interface FanoutConfig { inputs: Input[]; destinations: Destination[]; routes: RouteRule[] }

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** 完整 IP 原樣回傳；/8 /16 /24 轉為 startswith 前綴；其他回 null */
export function cidrToPrefix(s: string): string | null {
  const [addr, mask] = s.split('/')
  const m = IP_RE.exec(addr)
  if (!m || m.slice(1).some((o) => Number(o) > 255)) return null
  if (mask === undefined) return addr
  const octets = addr.split('.')
  if (mask === '24') return `${octets[0]}.${octets[1]}.${octets[2]}.`
  if (mask === '16') return `${octets[0]}.${octets[1]}.`
  if (mask === '8') return `${octets[0]}.`
  return null
}

const name = z.string().min(1).max(64)
const port = z.number().int().min(1).max(65535)
const protocol = z.enum(['udp', 'tcp'])

export const InputCreateSchema = z.object({ name, protocol, port, enabled: z.boolean() })
export const DestinationCreateSchema = z.object({
  name, protocol, host: z.string().min(1).max(255), port,
  headerMode: z.enum(['raw', 'standard']).default('raw'), enabled: z.boolean(),
})
export const RouteCreateSchema = z.object({
  inputId: z.number().int().positive(),
  destinationId: z.number().int().positive(),
  sourceFilter: z.string().nullable().refine((v) => v === null || cidrToPrefix(v) !== null,
    { message: '僅接受完整 IP 或 /8、/16、/24 CIDR' }),
  facilities: z.array(z.number().int().min(0).max(23)).nullable(),
  maxSeverity: z.number().int().min(0).max(7).nullable(),
})
export type InputCreate = z.infer<typeof InputCreateSchema>
export type DestinationCreate = z.infer<typeof DestinationCreateSchema>
export type RouteCreate = z.infer<typeof RouteCreateSchema>
```

- [ ] **Step 4: 測試通過**——`npx vitest run`，預期全綠。

- [ ] **Step 5: Commit**

```bash
git add server && git commit -m "feat: domain 型別與 zod 驗證 schema"
```

---

### Task 3: SQLite db + repository

**Files:**
- Create: `server/src/db/db.ts`, `server/src/domain/repo.ts`
- Test: `server/test/repo.test.ts`

**Interfaces:**
- Consumes: Task 2 的型別與 create schemas。
- Produces：

```ts
openDb(path: string): Database            // ':memory:' 供測試；自動跑 migration
createRepo(db: Database): Repo
interface Repo {
  listInputs(): Input[];  createInput(d: InputCreate): Input
  updateInput(id: number, d: InputCreate): Input | null;  deleteInput(id: number): boolean
  listDestinations(): Destination[];  createDestination(d: DestinationCreate): Destination
  updateDestination(id: number, d: DestinationCreate): Destination | null;  deleteDestination(id: number): boolean
  listRoutes(): RouteRule[];  createRoute(d: RouteCreate): RouteRule;  deleteRoute(id: number): boolean
  getConfig(): FanoutConfig
  getPasswordHash(): string | null;  setPasswordHash(h: string): void
  getAppliedHash(): string | null;  setAppliedHash(h: string): void
}
```

- [ ] **Step 1: 寫失敗測試**

`server/test/repo.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../src/db/db.js'
import { createRepo, type Repo } from '../src/domain/repo.js'

let repo: Repo
beforeEach(() => { repo = createRepo(openDb(':memory:')) })

describe('repo', () => {
  it('input CRUD 完整循環', () => {
    const i = repo.createInput({ name: 'n1', protocol: 'udp', port: 514, enabled: true })
    expect(i.id).toBeGreaterThan(0)
    expect(repo.listInputs()).toHaveLength(1)
    const u = repo.updateInput(i.id, { name: 'n2', protocol: 'tcp', port: 5140, enabled: false })
    expect(u?.name).toBe('n2')
    expect(u?.enabled).toBe(false)
    expect(repo.deleteInput(i.id)).toBe(true)
    expect(repo.listInputs()).toHaveLength(0)
  })
  it('刪除 input 連帶刪除其 routes（FK cascade）', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true })
    repo.createRoute({ inputId: i.id, destinationId: d.id, sourceFilter: null, facilities: null, maxSeverity: null })
    repo.deleteInput(i.id)
    expect(repo.listRoutes()).toHaveLength(0)
  })
  it('route 的 facilities 以 JSON 往返保真', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: 'h', port: 1, headerMode: 'raw', enabled: true })
    const r = repo.createRoute({ inputId: i.id, destinationId: d.id, sourceFilter: '10.1.0.0/16', facilities: [16, 17], maxSeverity: 4 })
    expect(repo.listRoutes()[0]).toEqual(r)
    expect(r.facilities).toEqual([16, 17])
  })
  it('密碼雜湊與 appliedHash 可存取', () => {
    expect(repo.getPasswordHash()).toBeNull()
    repo.setPasswordHash('hash1')
    expect(repo.getPasswordHash()).toBe('hash1')
    repo.setAppliedHash('abc')
    expect(repo.getAppliedHash()).toBe('abc')
  })
})
```

- [ ] **Step 2: 執行確認失敗**——`npx vitest run test/repo.test.ts`。

- [ ] **Step 3: 實作**

`server/src/db/db.ts`：

```ts
import DatabaseCtor from 'better-sqlite3'
import type { Database } from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
  port INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('udp','tcp')),
  host TEXT NOT NULL, port INTEGER NOT NULL,
  header_mode TEXT NOT NULL DEFAULT 'raw' CHECK(header_mode IN ('raw','standard')),
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_id INTEGER NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  source_filter TEXT, facilities TEXT, max_severity INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export function openDb(path: string): Database {
  const db = new DatabaseCtor(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
export type { Database }
```

`server/src/domain/repo.ts`（rows 與 domain 物件的轉換集中在此；enabled 以 0/1 存、boolean 出）：

```ts
import type { Database } from '../db/db.js'
import type { Input, Destination, RouteRule, FanoutConfig, InputCreate, DestinationCreate, RouteCreate } from './types.js'

const toInput = (r: any): Input => ({ id: r.id, name: r.name, protocol: r.protocol, port: r.port, enabled: !!r.enabled })
const toDest = (r: any): Destination => ({
  id: r.id, name: r.name, protocol: r.protocol, host: r.host, port: r.port,
  headerMode: r.header_mode, enabled: !!r.enabled,
})
const toRoute = (r: any): RouteRule => ({
  id: r.id, inputId: r.input_id, destinationId: r.destination_id,
  sourceFilter: r.source_filter, facilities: r.facilities ? JSON.parse(r.facilities) : null,
  maxSeverity: r.max_severity,
})

export interface Repo {
  listInputs(): Input[]; createInput(d: InputCreate): Input
  updateInput(id: number, d: InputCreate): Input | null; deleteInput(id: number): boolean
  listDestinations(): Destination[]; createDestination(d: DestinationCreate): Destination
  updateDestination(id: number, d: DestinationCreate): Destination | null; deleteDestination(id: number): boolean
  listRoutes(): RouteRule[]; createRoute(d: RouteCreate): RouteRule; deleteRoute(id: number): boolean
  getConfig(): FanoutConfig
  getPasswordHash(): string | null; setPasswordHash(h: string): void
  getAppliedHash(): string | null; setAppliedHash(h: string): void
}

export function createRepo(db: Database): Repo {
  const getSetting = (k: string): string | null =>
    (db.prepare('SELECT value FROM settings WHERE key=?').get(k) as any)?.value ?? null
  const setSetting = (k: string, v: string): void => {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v)
  }
  return {
    listInputs: () => (db.prepare('SELECT * FROM inputs ORDER BY id').all()).map(toInput),
    createInput(d) {
      const r = db.prepare('INSERT INTO inputs(name,protocol,port,enabled) VALUES(?,?,?,?)')
        .run(d.name, d.protocol, d.port, d.enabled ? 1 : 0)
      return { id: Number(r.lastInsertRowid), ...d }
    },
    updateInput(id, d) {
      const r = db.prepare('UPDATE inputs SET name=?,protocol=?,port=?,enabled=? WHERE id=?')
        .run(d.name, d.protocol, d.port, d.enabled ? 1 : 0, id)
      return r.changes ? { id, ...d } : null
    },
    deleteInput: (id) => db.prepare('DELETE FROM inputs WHERE id=?').run(id).changes > 0,
    listDestinations: () => (db.prepare('SELECT * FROM destinations ORDER BY id').all()).map(toDest),
    createDestination(d) {
      const r = db.prepare('INSERT INTO destinations(name,protocol,host,port,header_mode,enabled) VALUES(?,?,?,?,?,?)')
        .run(d.name, d.protocol, d.host, d.port, d.headerMode, d.enabled ? 1 : 0)
      return { id: Number(r.lastInsertRowid), ...d }
    },
    updateDestination(id, d) {
      const r = db.prepare('UPDATE destinations SET name=?,protocol=?,host=?,port=?,header_mode=?,enabled=? WHERE id=?')
        .run(d.name, d.protocol, d.host, d.port, d.headerMode, d.enabled ? 1 : 0, id)
      return r.changes ? { id, ...d } : null
    },
    deleteDestination: (id) => db.prepare('DELETE FROM destinations WHERE id=?').run(id).changes > 0,
    listRoutes: () => (db.prepare('SELECT * FROM routes ORDER BY id').all()).map(toRoute),
    createRoute(d) {
      const r = db.prepare('INSERT INTO routes(input_id,destination_id,source_filter,facilities,max_severity) VALUES(?,?,?,?,?)')
        .run(d.inputId, d.destinationId, d.sourceFilter, d.facilities ? JSON.stringify(d.facilities) : null, d.maxSeverity)
      return { id: Number(r.lastInsertRowid), ...d }
    },
    deleteRoute: (id) => db.prepare('DELETE FROM routes WHERE id=?').run(id).changes > 0,
    getConfig() {
      return { inputs: this.listInputs(), destinations: this.listDestinations(), routes: this.listRoutes() }
    },
    getPasswordHash: () => getSetting('password_hash'),
    setPasswordHash: (h) => setSetting('password_hash', h),
    getAppliedHash: () => getSetting('applied_hash'),
    setAppliedHash: (h) => setSetting('applied_hash', h),
  }
}
```

- [ ] **Step 4: 測試通過**——`npx vitest run`。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: SQLite schema 與 repository"`

---

### Task 4: rsyslog conf 產生器（golden tests，本專案核心）

**Files:**
- Create: `server/src/rsyslog/generate.ts`
- Test: `server/test/generate.test.ts`, `server/test/golden/full.conf`

**Interfaces:**
- Consumes: Task 2 的 `FanoutConfig`、`cidrToPrefix`。
- Produces: `generateConf(cfg: FanoutConfig, opts: GenOpts): string`，其中 `GenOpts = { tailPort: number; dataDir: string }`。純函式、決定性輸出（相同輸入必產生逐字相同 conf）。`configHash(cfg: FanoutConfig): string`（sha256 of stable JSON，供 dirty 判定）。

**產出 conf 的結構規則（實作依據）：**
- 開頭：`global(workDirectory=...)`、載入 `imudp`/`imtcp`/`impstats`（impstats：`interval="10" format="json" resetCounters="off" log.file="<dataDir>/stats/impstats.json" log.syslog="off"`）。
- 模板：`t_raw`（`%rawmsg%`）、`t_std`（`<%pri%>%timestamp% %hostname% %syslogtag%%msg%`）、每個 input 一個 `t_tail_i<id>`（JSON 含 src/input/fac/sev/msg，msg 用 `%rawmsg:::json%`）。
- 每個 enabled input：`input(type="im<proto>" port="<port>" ruleset="rs_i<id>")` + ruleset。ruleset 內第一個 action 是 tail 複製（omfwd → 127.0.0.1:tailPort, udp, t_tail_i<id>）。
- 每條 route（input 與 destination 都 enabled 才輸出）：無過濾直接放 action；有過濾包 `if (...) then { action }`。條件由 sourceFilter（`$fromhost-ip startswith "<prefix>"`；完整 IP 用 `==`）、facilities（`($syslogfacility == a or $syslogfacility == b)`）、maxSeverity（`$syslogseverity <= n`）以 `and` 串接。
- destination action：`action(name="d<did>_i<iid>" type="omfwd" target=... port=... protocol=... template="t_raw|t_std" queue.type="LinkedList" queue.filename="q_i<iid>_d<did>" queue.maxdiskspace="1g" queue.saveonshutdown="on" action.resumeRetryCount="-1")`。

- [ ] **Step 1: 寫 golden file 與失敗測試**

`server/test/golden/full.conf`（手寫預期輸出——實作必須逐字符合；此檔即規格）：

```
global(workDirectory="/data/queues")
module(load="imudp")
module(load="imtcp")
module(load="impstats" interval="10" format="json" resetCounters="off" log.file="/data/stats/impstats.json" log.syslog="off")

template(name="t_raw" type="string" string="%rawmsg%")
template(name="t_std" type="string" string="<%pri%>%timestamp% %hostname% %syslogtag%%msg%")
template(name="t_tail_i1" type="string" string="{\"src\":\"%fromhost-ip%\",\"input\":1,\"fac\":%syslogfacility%,\"sev\":%syslogseverity%,\"msg\":\"%rawmsg:::json%\"}")

input(type="imudp" port="514" ruleset="rs_i1")
ruleset(name="rs_i1") {
  action(type="omfwd" target="127.0.0.1" port="15514" protocol="udp" template="t_tail_i1")
  action(name="d1_i1" type="omfwd" target="10.0.0.5" port="514" protocol="udp" template="t_raw" queue.type="LinkedList" queue.filename="q_i1_d1" queue.maxdiskspace="1g" queue.saveonshutdown="on" action.resumeRetryCount="-1")
  if ($fromhost-ip startswith "10.1." and ($syslogfacility == 16 or $syslogfacility == 17) and $syslogseverity <= 4) then {
    action(name="d2_i1" type="omfwd" target="10.0.0.6" port="1514" protocol="tcp" template="t_std" queue.type="LinkedList" queue.filename="q_i1_d2" queue.maxdiskspace="1g" queue.saveonshutdown="on" action.resumeRetryCount="-1")
  }
}
```

`server/test/generate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateConf, configHash } from '../src/rsyslog/generate.js'
import type { FanoutConfig } from '../src/domain/types.js'

const cfg: FanoutConfig = {
  inputs: [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }],
  destinations: [
    { id: 1, name: 'arcsight', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true },
    { id: 2, name: 'backup', protocol: 'tcp', host: '10.0.0.6', port: 1514, headerMode: 'standard', enabled: true },
  ],
  routes: [
    { id: 1, inputId: 1, destinationId: 1, sourceFilter: null, facilities: null, maxSeverity: null },
    { id: 2, inputId: 1, destinationId: 2, sourceFilter: '10.1.0.0/16', facilities: [16, 17], maxSeverity: 4 },
  ],
}
const opts = { tailPort: 15514, dataDir: '/data' }

describe('generateConf', () => {
  it('完整組合逐字符合 golden file', () => {
    expect(generateConf(cfg, opts)).toBe(readFileSync('test/golden/full.conf', 'utf8'))
  })
  it('停用的 input 不輸出 input/ruleset', () => {
    const c = { ...cfg, inputs: [{ ...cfg.inputs[0], enabled: false }] }
    const out = generateConf(c, opts)
    expect(out).not.toContain('input(type=')
    expect(out).not.toContain('ruleset(')
  })
  it('停用的 destination 其 route 不輸出', () => {
    const c = { ...cfg, destinations: [cfg.destinations[0], { ...cfg.destinations[1], enabled: false }] }
    expect(generateConf(c, opts)).not.toContain('d2_i1')
  })
  it('完整 IP sourceFilter 使用 ==', () => {
    const c = { ...cfg, routes: [{ ...cfg.routes[0], sourceFilter: '10.9.9.9' }] }
    expect(generateConf(c, opts)).toContain(`if ($fromhost-ip == "10.9.9.9") then {`)
  })
  it('configHash 對相同內容穩定、不同內容相異', () => {
    expect(configHash(cfg)).toBe(configHash(structuredClone(cfg)))
    expect(configHash(cfg)).not.toBe(configHash({ ...cfg, routes: [] }))
  })
})
```

- [ ] **Step 2: 執行確認失敗**——`npx vitest run test/generate.test.ts`。

- [ ] **Step 3: 實作**

`server/src/rsyslog/generate.ts`：

```ts
import { createHash } from 'node:crypto'
import type { FanoutConfig, Destination, RouteRule } from '../domain/types.js'
import { cidrToPrefix } from '../domain/types.js'

export interface GenOpts { tailPort: number; dataDir: string }

const destAction = (d: Destination, inputId: number): string => {
  const tpl = d.headerMode === 'raw' ? 't_raw' : 't_std'
  return `action(name="d${d.id}_i${inputId}" type="omfwd" target="${d.host}" port="${d.port}" protocol="${d.protocol}" template="${tpl}" queue.type="LinkedList" queue.filename="q_i${inputId}_d${d.id}" queue.maxdiskspace="1g" queue.saveonshutdown="on" action.resumeRetryCount="-1")`
}

const condition = (r: RouteRule): string | null => {
  const parts: string[] = []
  if (r.sourceFilter) {
    const p = cidrToPrefix(r.sourceFilter)
    if (p === r.sourceFilter) parts.push(`$fromhost-ip == "${p}"`)
    else parts.push(`$fromhost-ip startswith "${p}"`)
  }
  if (r.facilities?.length)
    parts.push(`(${r.facilities.map((f) => `$syslogfacility == ${f}`).join(' or ')})`)
  if (r.maxSeverity !== null) parts.push(`$syslogseverity <= ${r.maxSeverity}`)
  return parts.length ? parts.join(' and ') : null
}

export function generateConf(cfg: FanoutConfig, opts: GenOpts): string {
  const L: string[] = []
  L.push(`global(workDirectory="${opts.dataDir}/queues")`)
  L.push('module(load="imudp")', 'module(load="imtcp")')
  L.push(`module(load="impstats" interval="10" format="json" resetCounters="off" log.file="${opts.dataDir}/stats/impstats.json" log.syslog="off")`)
  L.push('')
  L.push('template(name="t_raw" type="string" string="%rawmsg%")')
  L.push('template(name="t_std" type="string" string="<%pri%>%timestamp% %hostname% %syslogtag%%msg%")')
  const enabledInputs = cfg.inputs.filter((i) => i.enabled)
  for (const i of enabledInputs)
    L.push(`template(name="t_tail_i${i.id}" type="string" string="{\\"src\\":\\"%fromhost-ip%\\",\\"input\\":${i.id},\\"fac\\":%syslogfacility%,\\"sev\\":%syslogseverity%,\\"msg\\":\\"%rawmsg:::json%\\"}")`)
  const destById = new Map(cfg.destinations.map((d) => [d.id, d]))
  for (const i of enabledInputs) {
    L.push('')
    L.push(`input(type="im${i.protocol}" port="${i.port}" ruleset="rs_i${i.id}")`)
    L.push(`ruleset(name="rs_i${i.id}") {`)
    L.push(`  action(type="omfwd" target="127.0.0.1" port="${opts.tailPort}" protocol="udp" template="t_tail_i${i.id}")`)
    for (const r of cfg.routes.filter((r) => r.inputId === i.id)) {
      const d = destById.get(r.destinationId)
      if (!d || !d.enabled) continue
      const cond = condition(r)
      if (cond === null) L.push(`  ${destAction(d, i.id)}`)
      else L.push(`  if (${cond}) then {`, `    ${destAction(d, i.id)}`, '  }')
    }
    L.push('}')
  }
  return L.join('\n') + '\n'
}

export function configHash(cfg: FanoutConfig): string {
  return createHash('sha256').update(JSON.stringify(cfg)).digest('hex')
}
```

- [ ] **Step 4: 測試通過**——`npx vitest run`。golden 比對失敗時，diff 輸出即為修正依據；以 golden file 為準修實作，不是反過來。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: rsyslog conf 產生器與 golden file 測試"`

---

### Task 5: 套用流程（驗證/切換/回滾）

**Files:**
- Create: `server/src/rsyslog/apply.ts`
- Test: `server/test/apply.test.ts`

**Interfaces:**
- Consumes: Task 4 `generateConf`/`configHash`、Task 3 `Repo`。
- Produces：

```ts
interface ApplyDeps {
  repo: Repo
  paths: { staging: string; live: string; backup: string }   // 三個 conf 檔完整路徑
  genOpts: GenOpts
  validate(confPath: string): Promise<{ ok: boolean; output: string }>   // 包 rsyslogd -N1
  restart(): Promise<{ ok: boolean; output: string }>                     // 包 s6-svc -r；回傳重啟後 5 秒內是否存活
}
applyConfig(deps: ApplyDeps): Promise<ApplyResult>
type ApplyResult = { applied: true } | { applied: false; stage: 'validate' | 'restart'; error: string }
```

- 真實 `validate`/`restart` 實作於 Task 10 bootstrap 注入（`execFile(RSYSLOGD_BIN, ['-N1','-f',path])`；restart 用 `s6-svc -r /run/service/rsyslogd` 後 sleep 5 秒再 `s6-svstat` 檢查）。測試用假函式。

- [ ] **Step 1: 寫失敗測試**

`server/test/apply.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db.js'
import { createRepo, type Repo } from '../src/domain/repo.js'
import { applyConfig } from '../src/rsyslog/apply.js'
import { configHash } from '../src/rsyslog/generate.js'

let repo: Repo, dir: string, paths: { staging: string; live: string; backup: string }
const okCmd = async () => ({ ok: true, output: '' })
const genOpts = { tailPort: 15514, dataDir: '/data' }

beforeEach(() => {
  repo = createRepo(openDb(':memory:'))
  repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true })
  dir = mkdtempSync(join(tmpdir(), 'fanout-'))
  paths = { staging: join(dir, 's.conf'), live: join(dir, 'l.conf'), backup: join(dir, 'b.conf') }
})

describe('applyConfig', () => {
  it('成功：staging 內容進 live、appliedHash 更新', async () => {
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart: okCmd })
    expect(r.applied).toBe(true)
    expect(readFileSync(paths.live, 'utf8')).toContain('rs_i1')
    expect(repo.getAppliedHash()).toBe(configHash(repo.getConfig()))
  })
  it('驗證失敗：不動 live、回傳 rsyslogd 輸出', async () => {
    writeFileSync(paths.live, 'OLD')
    const r = await applyConfig({ repo, paths, genOpts, validate: async () => ({ ok: false, output: 'syntax err' }), restart: okCmd })
    expect(r).toEqual({ applied: false, stage: 'validate', error: 'syntax err' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
  })
  it('重啟失敗：還原備份並再次 restart', async () => {
    writeFileSync(paths.live, 'OLD')
    let calls = 0
    const restart = async () => ({ ok: ++calls > 1, output: calls === 1 ? 'crashed' : '' })
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart })
    expect(r).toEqual({ applied: false, stage: 'restart', error: 'crashed' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
    expect(calls).toBe(2)
  })
  it('首次套用（無現行 live）也成功', async () => {
    expect(existsSync(paths.live)).toBe(false)
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart: okCmd })
    expect(r.applied).toBe(true)
  })
})
```

- [ ] **Step 2: 執行確認失敗**——`npx vitest run test/apply.test.ts`。

- [ ] **Step 3: 實作**

`server/src/rsyslog/apply.ts`：

```ts
import { writeFileSync, copyFileSync, existsSync } from 'node:fs'
import type { Repo } from '../domain/repo.js'
import { generateConf, configHash, type GenOpts } from './generate.js'

export interface CmdResult { ok: boolean; output: string }
export interface ApplyDeps {
  repo: Repo
  paths: { staging: string; live: string; backup: string }
  genOpts: GenOpts
  validate(confPath: string): Promise<CmdResult>
  restart(): Promise<CmdResult>
}
export type ApplyResult =
  | { applied: true }
  | { applied: false; stage: 'validate' | 'restart'; error: string }

export async function applyConfig(deps: ApplyDeps): Promise<ApplyResult> {
  const cfg = deps.repo.getConfig()
  writeFileSync(deps.paths.staging, generateConf(cfg, deps.genOpts))

  const v = await deps.validate(deps.paths.staging)
  if (!v.ok) return { applied: false, stage: 'validate', error: v.output }

  const hadLive = existsSync(deps.paths.live)
  if (hadLive) copyFileSync(deps.paths.live, deps.paths.backup)
  copyFileSync(deps.paths.staging, deps.paths.live)

  const r = await deps.restart()
  if (!r.ok) {
    if (hadLive) {
      copyFileSync(deps.paths.backup, deps.paths.live)
      await deps.restart()
    }
    return { applied: false, stage: 'restart', error: r.output }
  }
  deps.repo.setAppliedHash(configHash(cfg))
  return { applied: true }
}
```

- [ ] **Step 4: 測試通過**——`npx vitest run`。
- [ ] **Step 5: Commit**——`git add server && git commit -m "feat: 設定套用流程（驗證、切換、回滾）"`

Phase 1 完成後：`npx vitest run --coverage` 確認核心模組覆蓋率，接續 [02-backend-api.md](02-backend-api.md)。
