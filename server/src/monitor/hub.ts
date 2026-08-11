// MonitorHub 介面先於 Task 6 定義，供 app.ts 型別引用；實作見 Task 8/9。

export interface MonitorSnapshot {
  inputs: Record<string, unknown>
  actions: Record<string, unknown>
  sources: unknown[]
}

export interface MonitorHub {
  snapshot(): MonitorSnapshot
  onStats(cb: (stats: unknown) => void): () => void
  onTail(cb: (line: unknown) => void): () => void
}
