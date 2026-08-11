import { defineStore } from 'pinia'

export interface TailMsg {
  src: string
  input: number
  fac: number
  sev: number
  msg: string
  ts: number
}

const MAX_LINES = 1000

export const useTail = defineStore('tail', {
  state: () => ({
    lines: [] as TailMsg[],
    paused: false,
    filterInput: null as number | null,
    _snapshot: [] as TailMsg[],
  }),
  getters: {
    // paused 時凍結畫面：回傳暫停當下取的快照（已套用當時的 filter），
    // 忽略暫停期間新累積的 lines。未暫停時即時依 filterInput 篩選。
    visible(state): TailMsg[] {
      if (state.paused) return state._snapshot
      return state.filterInput === null ? state.lines : state.lines.filter((l) => l.input === state.filterInput)
    },
  },
  actions: {
    push(m: TailMsg) {
      this.lines = [...this.lines, m].slice(-MAX_LINES)
    },
    setPaused(p: boolean) {
      if (p) {
        this._snapshot = this.filterInput === null ? this.lines : this.lines.filter((l) => l.input === this.filterInput)
      }
      this.paused = p
    },
  },
})
