import { readFileSync, statSync } from 'node:fs'
import type { HubInternals } from './hub.js'

export interface ImpstatsEntry { name: string; origin: string; values: Record<string, number> }

// impstats 以 log.file 輸出時每行帶 `Fri Aug 14 22:08:27 2026: ` 時間戳前綴，
// JSON 本體從第一個 `{` 開始。
export function parseImpstatsLine(line: string): ImpstatsEntry | null {
  const start = line.indexOf('{')
  if (start < 0) return null
  try {
    const o = JSON.parse(line.slice(start))
    if (typeof o.name !== 'string' || typeof o.origin !== 'string') return null
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') values[k] = v
    return { name: o.name, origin: o.origin, values }
  } catch { return null }
}

// rate 計算基準與告警去重，由每個 reader（或測試）自行持有，避免跨實例污染
export interface ApplyState { prevSubmitted: Map<string, number>; formatWarned: boolean }
export const createApplyState = (): ApplyState => ({ prevSubmitted: new Map(), formatWarned: false })

// 實機名稱格式（rsyslog 8）：UDP 監聽一埠兩條 imudp(*/514/IPv4|IPv6)，TCP 為 imtcp(514)；
// imudp(w0) 這類 worker 條目不屬於監聽統計。
const IMUDP_LISTENER_RE = /^imudp\(\*\/(\d+)\/IPv[46]\)$/
const IMTCP_LISTENER_RE = /^imtcp\((\d+)\)$/
const WORKER_RE = /^im(udp|tcp)\(w\d+\)$/
// 只有 generate.ts 產生的路由 action（d<destId>_i<inputId>）要進統計；
// 內部 tail 轉發等 builtin action 排除。
const ROUTE_ACTION_RE = /^d\d+_i\d+$/

function listenerKey(name: string): string | null {
  const udp = IMUDP_LISTENER_RE.exec(name)
  if (udp) return `udp:${udp[1]}`
  const tcp = IMTCP_LISTENER_RE.exec(name)
  if (tcp) return `tcp:${tcp[1]}`
  return null
}

export function applyEntries(
  hub: HubInternals, entries: ImpstatsEntry[], intervalSec: number,
  state: ApplyState, warn?: (msg: string) => void,
): void {
  const queueSizes = new Map<string, number>()
  for (const e of entries) {
    if (e.origin === 'core.queue') queueSizes.set(e.name.replace(/ queue$/, ''), e.values.size ?? 0)
  }
  // 計數器為累計值（resetCounters=off）：同名條目在一個 batch 內可能有多個
  // 時間快照（如重啟後從頭讀檔），先取每個名稱的最後一筆，
  // 再把同一埠的 IPv4/IPv6 條目加總，以總量算 rate。
  const latestByName = new Map<string, { key: string; submitted: number }>()
  let sawListenerOrigin = false
  for (const e of entries) {
    const key = listenerKey(e.name)
    if (key) {
      latestByName.set(e.name, { key, submitted: e.values.submitted ?? 0 })
    } else if (e.origin === 'core.action' && ROUTE_ACTION_RE.test(e.name)) {
      hub.setAction(e.name, {
        processed: e.values.processed ?? 0, failed: e.values.failed ?? 0,
        suspended: (e.values.suspended ?? 0) > 0, queueSize: queueSizes.get(e.name) ?? 0,
      })
    } else if ((e.origin === 'imudp' || e.origin === 'imtcp') && !WORKER_RE.test(e.name)) {
      sawListenerOrigin = true
    }
  }
  // 有監聽 origin 的條目卻一個都對不上名稱格式：多半是 rsyslog 版本更換了
  // 輸出格式（本模組曾因此整組統計沉默失效），告警一次以利定位。
  if (sawListenerOrigin && latestByName.size === 0 && !state.formatWarned) {
    state.formatWarned = true
    warn?.('impstats: listener entries present but none matched expected name formats (imudp(*/<port>/IPv4|IPv6), imtcp(<port>)) — rsyslog output format may have changed')
  }
  const submittedByKey = new Map<string, number>()
  for (const { key, submitted } of latestByName.values()) {
    submittedByKey.set(key, (submittedByKey.get(key) ?? 0) + submitted)
  }
  for (const [key, submitted] of submittedByKey) {
    const prev = state.prevSubmitted.get(key)
    // rsyslogd 每次 Apply 都會重啟，行程內計數器歸零重算 → clamp 避免負速率
    const rate = prev === undefined ? 0 : Math.max(0, (submitted - prev) / intervalSec)
    state.prevSubmitted.set(key, submitted)
    hub.setInput(key, submitted, rate)
  }
  hub.emitStats()
}

export function createImpstatsReader(
  path: string, hub: HubInternals, intervalMs = 10000, warn?: (msg: string) => void,
) {
  const state = createApplyState()
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
      if (entries.length) applyEntries(hub, entries, intervalMs / 1000, state, warn)
    } catch { /* 檔案尚未存在：rsyslog 未啟動前屬正常，靜默略過 */ }
  }
  return { start: () => { timer = setInterval(tick, intervalMs); tick() }, stop: () => { if (timer) clearInterval(timer) } }
}
