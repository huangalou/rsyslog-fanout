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
    dirty: false,
    wsOpen: false,
    _stop: null as null | (() => void),
    _timer: null as null | number,
    // start() 內部有一段 await（GET /api/stats/overview）；若使用者在該 await
    // 完成前就呼叫 stop()，_cancelled 讓 resolve 之後的 start() 續行程式碼
    // 知道自己已被取消，不再建立 WS 連線 / setInterval（否則會變成沒有
    // _stop/_timer 參照、無人能取消的洩漏）。
    _cancelled: false,
  }),
  actions: {
    ingest(s: Snapshot) {
      this.snapshot = s
      const total = Object.values(s.inputs).reduce((a, i) => a + i.rate, 0)
      this.history = [...this.history, { ts: Date.now(), total }].slice(-360)
    },
    async start() {
      this._cancelled = false
      const init = await api.get<Snapshot & { tail: unknown[] }>('/api/stats/overview')
      if (this._cancelled) return
      this.ingest(init)
      this._stop = connectWs({ onStats: (s) => this.ingest(s as Snapshot), onState: (o) => (this.wsOpen = o) })
      const poll = async () => {
        this.dirty = (await api.get<{ dirty: boolean }>('/api/config/status')).dirty
      }
      poll()
      this._timer = window.setInterval(poll, 10000)
    },
    stop() {
      this._cancelled = true
      this._stop?.()
      this._stop = null
      if (this._timer) clearInterval(this._timer)
      this._timer = null
    },
  },
})
