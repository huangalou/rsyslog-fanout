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
      const poll = async () => {
        this.dirty = (await api.get<{ dirty: boolean }>('/api/config/status')).dirty
      }
      poll()
      this._timer = window.setInterval(poll, 10000)
    },
    stop() {
      this._stop?.()
      if (this._timer) clearInterval(this._timer)
    },
  },
})
