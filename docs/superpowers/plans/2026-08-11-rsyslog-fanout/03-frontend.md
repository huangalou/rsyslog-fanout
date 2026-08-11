# Phase 3：前端 WebUI（Tasks 11-15）

> 前置：完成 [02-backend-api.md](02-backend-api.md)。指令都在 `web/` 執行。開發時 Vite proxy 把 `/api` 轉到 `http://localhost:8080`。

**視覺方向（一次定調，全部頁面沿用）：** 「ops console」風格——深色為主的監控介面（log 工具的自然語境），等寬字體用於 log 與數字、Inter 用於 UI 文案；狀態語意色：綠=健康、琥珀=佇列堆積/疑似斷訊、紅=不可達/失敗；卡片式儀表板配清楚的層級對比。所有色彩/間距/字體以 CSS custom properties 定義於 `src/styles/tokens.css`，禁止散落硬編碼。

### Task 11: web 鷹架 + api client + ws client + 登入頁

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/App.vue`, `web/src/router.ts`, `web/src/styles/tokens.css`
- Create: `web/src/api/client.ts`, `web/src/api/ws.ts`, `web/src/stores/session.ts`, `web/src/pages/Login.vue`
- Test: `web/test/client.test.ts`, `web/test/ws.test.ts`

**Interfaces:**
- Consumes: server API（envelope 格式、`/api/auth/login`、WS 訊息 `{ch:'stats'|'tail',data}`）。
- Produces（後續頁面任務依賴）：

```ts
// api/client.ts —— envelope 解包；401 時導向 /login
api.get<T>(url: string): Promise<T>
api.post<T>(url: string, body?: unknown): Promise<T>
api.put<T>(url: string, body?: unknown): Promise<T>
api.del<T>(url: string): Promise<T>
class ApiError extends Error { status: number }    // error 欄位內容為 message
// api/ws.ts
connectWs(handlers: { onStats?(s): void; onTail?(m): void; onState?(open: boolean): void }): () => void
// 指數退避：1s 起、每次 ×2、上限 30s；成功連上歸零。回傳斷線函式。
// stores/session.ts (Pinia)
useSession(): { loggedIn: Ref<boolean>, login(pw): Promise<void>, logout(): Promise<void> }
```

- [ ] **Step 1: 建鷹架**

```bash
npm create vite@latest web -- --template vue-ts
cd web && npm i pinia vue-router && npm i -D vitest @vue/test-utils jsdom
```

`web/vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': { target: 'http://localhost:8080', ws: true } } },
  test: { environment: 'jsdom' },
})
```

- [ ] **Step 2: 寫失敗測試**

`web/test/client.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { api, ApiError } from '../src/api/client'

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('api client', () => {
  it('成功時回傳 data', async () => {
    mockFetch(200, { success: true, data: [1, 2], error: null })
    expect(await api.get('/api/inputs')).toEqual([1, 2])
  })
  it('失敗時丟 ApiError 帶 error 訊息與 status', async () => {
    mockFetch(400, { success: false, data: null, error: '埠號不在允許範圍' })
    await expect(api.get('/api/inputs')).rejects.toMatchObject({ message: '埠號不在允許範圍', status: 400 })
  })
  it('401 時導向 /login', async () => {
    mockFetch(401, { success: false, data: null, error: '未登入' })
    const spy = vi.spyOn(window.history, 'pushState')
    await expect(api.get('/api/inputs')).rejects.toBeInstanceOf(ApiError)
    // router 注入見實作：client 觸發全域 callback
  })
})
```

`web/test/ws.test.ts`（測退避計算純函式）：

```ts
import { describe, it, expect } from 'vitest'
import { nextBackoff } from '../src/api/ws'

describe('nextBackoff', () => {
  it('1s 起每次翻倍、上限 30s', () => {
    expect(nextBackoff(0)).toBe(1000)
    expect(nextBackoff(1000)).toBe(2000)
    expect(nextBackoff(16000)).toBe(30000)
    expect(nextBackoff(30000)).toBe(30000)
  })
})
```

- [ ] **Step 3: 執行確認失敗**——`npx vitest run`。

- [ ] **Step 4: 實作**

`web/src/api/client.ts`：

```ts
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const env = await res.json() as { success: boolean; data: T; error: string | null }
  if (res.status === 401) onUnauthorized()
  if (!env.success) throw new ApiError(env.error ?? '未知錯誤', res.status)
  return env.data
}
export const api = {
  get: <T>(u: string) => request<T>('GET', u),
  post: <T>(u: string, b?: unknown) => request<T>('POST', u, b),
  put: <T>(u: string, b?: unknown) => request<T>('PUT', u, b),
  del: <T>(u: string) => request<T>('DELETE', u),
}
```

`web/src/api/ws.ts`：

```ts
export const nextBackoff = (prev: number): number => Math.min(prev === 0 ? 1000 : prev * 2, 30000)

export interface WsHandlers { onStats?(s: unknown): void; onTail?(m: unknown): void; onState?(open: boolean): void }

export function connectWs(h: WsHandlers): () => void {
  let ws: WebSocket | null = null
  let delay = 0
  let closed = false
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`)
    ws.onopen = () => { delay = 0; h.onState?.(true) }
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.ch === 'stats') h.onStats?.(m.data)
      if (m.ch === 'tail') h.onTail?.(m.data)
    }
    ws.onclose = () => {
      h.onState?.(false)
      if (closed) return
      delay = nextBackoff(delay)
      setTimeout(open, delay)
    }
  }
  open()
  return () => { closed = true; ws?.close() }
}
```

`web/src/stores/session.ts`、`web/src/router.ts`、`Login.vue`、`App.vue`（App 含側欄導航：Dashboard/接收設定/轉發設定/Live Tail/來源狀態，頂欄顯示「未套用變更」徽章——由 Task 12 的輪詢填值）：

```ts
// stores/session.ts
import { defineStore } from 'pinia'
import { api } from '../api/client'
export const useSession = defineStore('session', {
  state: () => ({ loggedIn: false }),
  actions: {
    async login(password: string) { await api.post('/api/auth/login', { password }); this.loggedIn = true },
    async logout() { await api.post('/api/auth/logout'); this.loggedIn = false },
  },
})
```

```ts
// router.ts
import { createRouter, createWebHistory } from 'vue-router'
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/Login.vue') },
    { path: '/', component: () => import('./pages/Dashboard.vue') },
    { path: '/inputs', component: () => import('./pages/Inputs.vue') },
    { path: '/forwarding', component: () => import('./pages/Forwarding.vue') },
    { path: '/tail', component: () => import('./pages/LiveTail.vue') },
    { path: '/sources', component: () => import('./pages/Sources.vue') },
  ],
})
```

`Login.vue`（表單 + 錯誤顯示；成功導向 `/`）：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSession } from '../stores/session'
const pw = ref(''); const err = ref(''); const router = useRouter(); const session = useSession()
async function submit() {
  err.value = ''
  try { await session.login(pw.value); router.push('/') }
  catch (e) { err.value = (e as Error).message }
}
</script>
<template>
  <main class="login">
    <form @submit.prevent="submit" aria-labelledby="login-title">
      <h1 id="login-title">Rsyslog FanOut</h1>
      <input v-model="pw" type="password" placeholder="管理密碼" autocomplete="current-password" />
      <button type="submit">登入</button>
      <p v-if="err" role="alert" class="error">{{ err }}</p>
    </form>
  </main>
</template>
```

`main.ts` 串起 pinia/router，並 `setUnauthorizedHandler(() => router.push('/login'))`。`tokens.css` 定義 `--color-bg/-surface/-text/-ok/-warn/-danger/-accent`、`--font-mono/-ui`、間距與 radius tokens。

- [ ] **Step 5: 測試通過 + build 通過後 commit**

```bash
npx vitest run && npm run build
git add web && git commit -m "feat: web 鷹架、api/ws client 與登入頁"
```

---

### Task 12: Dashboard + LineChart 元件

**Files:**
- Create: `web/src/pages/Dashboard.vue`, `web/src/components/LineChart.vue`, `web/src/components/StatusCard.vue`, `web/src/stores/stats.ts`
- Test: `web/test/stats-store.test.ts`

**Interfaces:**
- Consumes: `api`、`connectWs`、`GET /api/stats/overview`、`GET /api/config/status`。
- Produces: `useStats()` Pinia store —— `snapshot`（最新 StatsSnapshot）、`history: Array<{ts:number,total:number}>`（每次 stats 推播 append 總速率、保留 360 點=1 小時）、`dirty: boolean`（每 10 秒輪詢 config/status）、`start()/stop()`。`LineChart.vue` props：`points: Array<{ts:number,v:number}>`（純 SVG polyline，無第三方圖表依賴——控制 bundle 大小）。

- [ ] **Step 1: 寫失敗測試**

`web/test/stats-store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStats } from '../src/stores/stats'

beforeEach(() => setActivePinia(createPinia()))

describe('stats store', () => {
  it('ingest 累積 history 並計算總速率', () => {
    const s = useStats()
    s.ingest({ inputs: { 'udp:514': { submitted: 100, rate: 5 }, 'tcp:5140': { submitted: 10, rate: 2 } }, actions: {}, sources: [] })
    expect(s.history.at(-1)?.total).toBe(7)
    expect(s.snapshot?.inputs['udp:514'].rate).toBe(5)
  })
  it('history 超過 360 點丟最舊', () => {
    const s = useStats()
    for (let i = 0; i < 400; i++) s.ingest({ inputs: {}, actions: {}, sources: [] })
    expect(s.history).toHaveLength(360)
  })
})
```

- [ ] **Step 2: 確認失敗** → **Step 3: 實作**

`web/src/stores/stats.ts`：

```ts
import { defineStore } from 'pinia'
import { api } from '../api/client'
import { connectWs } from '../api/ws'

export interface Snapshot {
  inputs: Record<string, { submitted: number; rate: number }>
  actions: Record<string, { processed: number; failed: number; suspended: boolean; queueSize: number }>
  sources: Array<{ ip: string; lastSeen: number; stale: boolean }>
}

export const useStats = defineStore('stats', {
  state: () => ({
    snapshot: null as Snapshot | null,
    history: [] as Array<{ ts: number; total: number }>,
    dirty: false, wsOpen: false,
    _stop: null as null | (() => void), _timer: null as null | number,
  }),
  actions: {
    ingest(s: Snapshot) {
      this.snapshot = s
      const total = Object.values(s.inputs).reduce((a, i) => a + i.rate, 0)
      this.history = [...this.history, { ts: Date.now(), total }].slice(-360)
    },
    async start() {
      const init = await api.get<Snapshot & { tail: unknown[] }>('/api/stats/overview')
      this.ingest(init)
      this._stop = connectWs({ onStats: (s) => this.ingest(s as Snapshot), onState: (o) => (this.wsOpen = o) })
      const poll = async () => { this.dirty = (await api.get<{ dirty: boolean }>('/api/config/status')).dirty }
      poll(); this._timer = window.setInterval(poll, 10000)
    },
    stop() { this._stop?.(); if (this._timer) clearInterval(this._timer) },
  },
})
```

`LineChart.vue`（SVG polyline，viewBox 640x160，Y 軸自動縮放，動畫僅 opacity）與 `StatusCard.vue`（title/value/state props，state 對應語意色 class）。`Dashboard.vue`：掛載時 `stats.start()`、卸載 `stats.stop()`；上方總速率 LineChart、中段 input 卡片（速率/累計）、下段 destination 卡片（processed/failed/suspended/queueSize，suspended 紅、queueSize>1000 琥珀）；`dirty` 為 true 時頂部顯示「有未套用的變更 → 前往套用」連結至 /forwarding。

- [ ] **Step 4: 測試 + build 通過**——`npx vitest run && npm run build`。
- [ ] **Step 5: Commit**——`git add web && git commit -m "feat: Dashboard 儀表板與流量圖"`

---

### Task 13: Inputs 頁

**Files:**
- Create: `web/src/pages/Inputs.vue`, `web/src/components/EntityTable.vue`
- Test: `web/test/inputs-page.test.ts`

**Interfaces:**
- Consumes: `api`、`/api/inputs` CRUD。
- Produces: `EntityTable.vue`——通用清單表格（props: `columns: {key,label}[]`, `rows: any[]`；slots: `cell-<key>`、`actions`），Task 14/15 重用。

- [ ] **Step 1: 寫失敗測試**（@vue/test-utils + mock api）

`web/test/inputs-page.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async () => [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }]), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
import Inputs from '../src/pages/Inputs.vue'
import { api } from '../src/api/client'

describe('Inputs page', () => {
  it('載入後列出 input', async () => {
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('net')
    expect(w.text()).toContain('514')
  })
  it('送出新增表單呼叫 POST /api/inputs', async () => {
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="add"]').trigger('click')
    await w.find('[data-test="name"]').setValue('n2')
    await w.find('[data-test="port"]').setValue('5140')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/inputs', expect.objectContaining({ name: 'n2', port: 5140 }))
  })
})
```

- [ ] **Step 2: 確認失敗** → **Step 3: 實作**

`Inputs.vue` 行為：載入時 `api.get('/api/inputs')`；「新增」鈕開表單（name、protocol 下拉 udp/tcp、port 數字欄、enabled 開關）；編輯用同一表單帶入現值走 PUT；刪除有 `confirm()`；API 錯誤（如埠號超界）顯示在表單上方 `role="alert"`。頁面說明文字提示允許的埠範圍需與 compose 發布的一致。

- [ ] **Step 4: 測試 + build 通過** → **Step 5: Commit**——`git add web && git commit -m "feat: 接收設定（Inputs）頁"`

---

### Task 14: Forwarding 頁（Destinations + Routes + 套用）

**Files:**
- Create: `web/src/pages/Forwarding.vue`, `web/src/components/RouteMatrix.vue`, `web/src/components/RouteFilterForm.vue`
- Test: `web/test/forwarding-page.test.ts`

**Interfaces:**
- Consumes: `/api/destinations`、`/api/routes`、`/api/inputs`、`/api/config/apply`、`/api/config/status`。
- Produces: 無下游依賴（葉頁面）。

**頁面結構：**
1. **Destinations 區**：EntityTable 列出（name/protocol/host:port/headerMode/enabled），新增/編輯表單含 headerMode 選擇——radio 兩項並附說明文字：「`raw`（預設）：原樣轉發，下游收到與設備送出完全相同的內容」「`standard`：以 RFC3164 重寫表頭」。
2. **Routes 區（RouteMatrix）**：列=input、欄=destination 的核取矩陣；勾選=建 route（無過濾），取消=刪 route；每格旁「⚙」開 RouteFilterForm 設定 sourceFilter（文字欄，placeholder `10.1.2.3 或 10.1.0.0/16`）、facilities（0-23 多選下拉，顯示 local0-local7 等名稱）、maxSeverity（下拉 emerg(0)…debug(7)）。有過濾的格顯示濾鏡圖示。
3. **套用區**：「套用設定」按鈕 + dirty 徽章；按下呼叫 `/api/config/apply`，成功顯示綠色 toast；失敗把 `error`（rsyslogd 輸出）完整顯示在可捲動的 `<pre>` 區塊。

- [ ] **Step 1: 寫失敗測試**

`web/test/forwarding-page.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
const gets: Record<string, unknown> = {
  '/api/inputs': [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }],
  '/api/destinations': [{ id: 1, name: 'arcsight', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true }],
  '/api/routes': [], '/api/config/status': { dirty: true, lastResult: null },
}
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async (u: string) => gets[u]), post: vi.fn(async () => ({ applied: true })), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
import Forwarding from '../src/pages/Forwarding.vue'
import { api } from '../src/api/client'

describe('Forwarding page', () => {
  it('矩陣勾選建立 route', async () => {
    const w = mount(Forwarding, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="cell-1-1"] input[type=checkbox]').setValue(true)
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/routes', expect.objectContaining({ inputId: 1, destinationId: 1 }))
  })
  it('套用按鈕呼叫 config/apply', async () => {
    const w = mount(Forwarding, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/config/apply', undefined)
  })
})
```

- [ ] **Step 2: 確認失敗** → **Step 3: 實作**（依上方頁面結構；RouteMatrix 以 `data-test="cell-<inputId>-<destId>"` 標記格子）
- [ ] **Step 4: 測試 + build 通過** → **Step 5: Commit**——`git add web && git commit -m "feat: 轉發設定頁（目的地、路由矩陣、套用）"`

---

### Task 15: Live Tail + Sources 頁

**Files:**
- Create: `web/src/pages/LiveTail.vue`, `web/src/pages/Sources.vue`, `web/src/stores/tail.ts`
- Test: `web/test/tail-store.test.ts`

**Interfaces:**
- Consumes: `connectWs` 的 `onTail`、`stats` store 的 `sources`。
- Produces: `useTail()` store——`lines: TailMsg[]`（上限 1000，來自 WS）、`paused`、`filterInput: number | null`、`visible` getter（套 filter 與 paused 時凍結）。

- [ ] **Step 1: 寫失敗測試**

`web/test/tail-store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTail } from '../src/stores/tail'

beforeEach(() => setActivePinia(createPinia()))
const msg = (input: number, m: string) => ({ src: '10.0.0.9', input, fac: 16, sev: 6, msg: m, ts: 1 })

describe('tail store', () => {
  it('push 累積且超過 1000 丟最舊', () => {
    const t = useTail()
    for (let i = 0; i < 1005; i++) t.push(msg(1, `m${i}`))
    expect(t.lines).toHaveLength(1000)
    expect(t.lines[0].msg).toBe('m5')
  })
  it('filterInput 過濾 visible', () => {
    const t = useTail()
    t.push(msg(1, 'a')); t.push(msg(2, 'b'))
    t.filterInput = 2
    expect(t.visible.map((l) => l.msg)).toEqual(['b'])
  })
  it('paused 時 visible 凍結但 lines 繼續累積', () => {
    const t = useTail()
    t.push(msg(1, 'a'))
    t.setPaused(true)
    t.push(msg(1, 'b'))
    expect(t.visible.map((l) => l.msg)).toEqual(['a'])
    expect(t.lines).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 確認失敗** → **Step 3: 實作**

`stores/tail.ts`：`push` 維護上限；`setPaused(true)` 時把當前 visible 快照存起來；getter 依 paused 回快照或即時陣列。`LiveTail.vue`：等寬字體捲動區（自動捲到底、paused 停捲）、input 過濾下拉（值來自 `/api/inputs`）、暫停/繼續鈕、每行顯示時間/來源/severity 徽章/訊息。`Sources.vue`：表格列出 `stats.snapshot.sources`（IP、最後收到時間的相對表示、stale 紅色「疑似斷訊」徽章），依 lastSeen 排序。

- [ ] **Step 4: 測試 + build 通過** → **Step 5: Commit**——`git add web && git commit -m "feat: Live Tail 與來源狀態頁"`

Phase 3 完成，接續 [04-container-e2e-ci.md](04-container-e2e-ci.md)。
