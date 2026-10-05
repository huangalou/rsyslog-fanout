// 監控資料的單一匯流排（Task 6 空殼在此補完整；Task 8 正式定義）。

export interface TailMsg { src: string; input: number; fac: number; sev: number; msg: string; ts: number }
export interface InputStat { readonly submitted: number; readonly rate: number }
export interface ActionStat {
  readonly processed: number; readonly failed: number; readonly suspended: boolean; readonly queueSize: number
}
export interface SourceStat { readonly ip: string; readonly lastSeen: number; readonly stale: boolean }
export interface StatsSnapshot {
  readonly inputs: Readonly<Record<string, InputStat>>
  readonly actions: Readonly<Record<string, ActionStat>>
  readonly sources: readonly SourceStat[]
}
export interface MonitorHub {
  snapshot(): StatsSnapshot
  onStats(cb: (s: StatsSnapshot) => void): () => void
  onTail(cb: (m: TailMsg) => void): () => void
}
export interface HubInternals extends MonitorHub {
  setInput(key: string, submitted: number, rate: number): void
  setAction(key: string, v: ActionStat): void
  deleteInput(key: string): void
  deleteAction(key: string): void
  seenSource(ip: string, ts: number): void
  emitStats(): void
  emitTail(m: TailMsg): void
}

const withEntry = <V extends object>(rec: Readonly<Record<string, V>>, key: string, value: V): Readonly<Record<string, V>> =>
  Object.freeze({ ...rec, [key]: Object.freeze({ ...value }) })
const withoutKey = <V>(rec: Readonly<Record<string, V>>, key: string): Readonly<Record<string, V>> =>
  Object.freeze(Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key)))

export function createHub(opts: { staleAfterMs: number }): HubInternals {
  // inputs / actions 一律整份替換、不就地修改：每次更新產生新的凍結物件，
  // snapshot() 直接交出目前的參考即可，訂閱者拿到的內容之後不會變，也改不動 hub 的狀態。
  let inputs: StatsSnapshot['inputs'] = Object.freeze({})
  let actions: StatsSnapshot['actions'] = Object.freeze({})
  // sources 刻意維持就地更新的 Map：seenSource 位於每筆 tail 訊息的熱路徑（上限 500 筆/秒），
  // 每筆都複製整個 Map 的成本隨來源數線性成長。Map 本身不外流，snapshot() 每次另建凍結陣列。
  const sources = new Map<string, number>()
  const statsSubs = new Set<(s: StatsSnapshot) => void>()
  const tailSubs = new Set<(m: TailMsg) => void>()
  const snapshot = (): StatsSnapshot => {
    const now = Date.now()
    return Object.freeze({
      inputs, actions,
      sources: Object.freeze([...sources].map(([ip, lastSeen]) =>
        Object.freeze({ ip, lastSeen, stale: now - lastSeen > opts.staleAfterMs }))),
    })
  }
  return {
    snapshot,
    onStats: (cb) => (statsSubs.add(cb), () => statsSubs.delete(cb)),
    onTail: (cb) => (tailSubs.add(cb), () => tailSubs.delete(cb)),
    setInput: (k, submitted, rate) => void (inputs = withEntry(inputs, k, { submitted, rate })),
    setAction: (k, v) => void (actions = withEntry(actions, k, v)),
    deleteInput: (k) => void (inputs = withoutKey(inputs, k)),
    deleteAction: (k) => void (actions = withoutKey(actions, k)),
    seenSource: (ip, ts) => void sources.set(ip, ts),
    emitStats: () => {
      const s = snapshot()
      statsSubs.forEach((cb) => cb(s))
    },
    emitTail: (m) => tailSubs.forEach((cb) => cb(m)),
  }
}
