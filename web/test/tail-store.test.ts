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
