// 監控資料的單一匯流排（Task 6 空殼在此補完整；Task 8 正式定義）。

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
