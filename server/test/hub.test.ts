import { describe, it, expect } from 'vitest'
import { createHub } from '../src/monitor/hub.js'

describe('createHub', () => {
  it('seenSource 記錄來源，超過 staleAfterMs 視為 stale', () => {
    const hub = createHub({ staleAfterMs: 100 })
    hub.seenSource('10.0.0.1', Date.now())
    hub.seenSource('10.0.0.2', Date.now() - 1000)
    const s = hub.snapshot()
    const fresh = s.sources.find((x) => x.ip === '10.0.0.1')
    const stale = s.sources.find((x) => x.ip === '10.0.0.2')
    expect(fresh?.stale).toBe(false)
    expect(stale?.stale).toBe(true)
  })

  it('onTail 訂閱者收到 emitTail 訊息，取消訂閱後不再收到', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const received: string[] = []
    const off = hub.onTail((m) => received.push(m.msg))
    hub.emitTail({ src: '10.0.0.1', input: 514, fac: 1, sev: 6, msg: 'hello', ts: Date.now() })
    expect(received).toEqual(['hello'])
    off()
    hub.emitTail({ src: '10.0.0.1', input: 514, fac: 1, sev: 6, msg: 'world', ts: Date.now() })
    expect(received).toEqual(['hello'])
  })

  it('snapshot 取得後，後續的更新與刪除不影響已取得的 snapshot', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    hub.setInput('udp:514', 10, 1)
    hub.setAction('d1_i1', { processed: 10, failed: 0, suspended: false, queueSize: 0 })
    hub.seenSource('10.0.0.1', 1000)
    const before = hub.snapshot()

    hub.setInput('udp:514', 20, 2)
    hub.setInput('udp:515', 5, 0)
    hub.deleteAction('d1_i1')
    hub.seenSource('10.0.0.2', 2000)

    expect(before.inputs).toEqual({ 'udp:514': { submitted: 10, rate: 1 } })
    expect(Object.keys(before.actions)).toEqual(['d1_i1'])
    expect(before.sources.map((x) => x.ip)).toEqual(['10.0.0.1'])
  })

  it('外部改動 snapshot 的內容不會污染 hub 狀態', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    hub.setInput('udp:514', 10, 1)
    hub.setAction('d1_i1', { processed: 10, failed: 0, suspended: false, queueSize: 0 })
    const s = hub.snapshot()

    // 以下三行刻意違反 readonly 型別，驗證執行期也擋得住（型別若被放寬，@ts-expect-error 會報錯提醒）
    // @ts-expect-error 對 readonly 屬性賦值
    expect(() => { s.inputs['udp:514'].submitted = 999 }).toThrow(TypeError)
    // @ts-expect-error 對 readonly 屬性賦值
    expect(() => { s.actions['d1_i1'].failed = 999 }).toThrow(TypeError)
    // @ts-expect-error 對 readonly 索引簽章賦值
    expect(() => { s.inputs['udp:999'] = { submitted: 1, rate: 1 } }).toThrow(TypeError)

    expect(hub.snapshot().inputs).toEqual({ 'udp:514': { submitted: 10, rate: 1 } })
    expect(hub.snapshot().actions['d1_i1'].failed).toBe(0)
  })

  it('snapshot 的 sources 與頂層物件同樣不可被外部改動', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    hub.seenSource('10.0.0.1', Date.now())
    const s = hub.snapshot()

    // @ts-expect-error 對 readonly 陣列 push
    expect(() => { s.sources.push({ ip: '10.0.0.9', lastSeen: 0, stale: false }) }).toThrow(TypeError)
    // @ts-expect-error 對 readonly 屬性賦值
    expect(() => { s.sources[0].ip = '10.9.9.9' }).toThrow(TypeError)
    // @ts-expect-error 對 readonly 屬性賦值
    expect(() => { s.inputs = {} }).toThrow(TypeError)

    expect(hub.snapshot().sources.map((x) => x.ip)).toEqual(['10.0.0.1'])
  })

  it('setAction 之後呼叫端再改動傳入的物件，不影響 hub 狀態', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const v = { processed: 10, failed: 0, suspended: false, queueSize: 0 }
    hub.setAction('d1_i1', v)

    v.processed = 999

    expect(hub.snapshot().actions['d1_i1'].processed).toBe(10)
  })

  it('deleteInput / deleteAction 移除指定 key，其餘保留', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    hub.setInput('udp:514', 10, 1)
    hub.setInput('udp:515', 5, 0)
    hub.setAction('d1_i1', { processed: 1, failed: 0, suspended: false, queueSize: 0 })
    hub.setAction('d2_i1', { processed: 2, failed: 0, suspended: false, queueSize: 0 })

    hub.deleteInput('udp:514')
    hub.deleteAction('d1_i1')

    expect(Object.keys(hub.snapshot().inputs)).toEqual(['udp:515'])
    expect(Object.keys(hub.snapshot().actions)).toEqual(['d2_i1'])
  })

  it('emitStats 把同一份 snapshot 送給所有訂閱者', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    hub.setInput('udp:514', 10, 1)
    const received: unknown[] = []
    hub.onStats((s) => received.push(s))
    hub.onStats((s) => received.push(s))

    hub.emitStats()

    expect(received).toHaveLength(2)
    expect(received[0]).toBe(received[1])
  })
})
