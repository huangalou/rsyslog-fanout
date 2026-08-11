import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStats, type Snapshot } from '../src/stores/stats'
import { api } from '../src/api/client'
import { connectWs } from '../src/api/ws'

vi.mock('../src/api/ws', () => ({ connectWs: vi.fn(() => vi.fn()) }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

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
  it('start() 的 fetch 尚未 resolve 前呼叫 stop()，resolve 之後也不會建立 WS 連線（避免無人能取消的洩漏）', async () => {
    let resolveFetch: (v: Snapshot & { tail: unknown[] }) => void = () => {}
    const pending = new Promise<Snapshot & { tail: unknown[] }>((resolve) => {
      resolveFetch = resolve
    })
    vi.spyOn(api, 'get').mockReturnValue(pending)

    const s = useStats()
    const startPromise = s.start()
    s.stop()
    resolveFetch({ inputs: {}, actions: {}, sources: [], tail: [] })
    await startPromise

    expect(connectWs).not.toHaveBeenCalled()
  })
})
