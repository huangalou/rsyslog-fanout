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
