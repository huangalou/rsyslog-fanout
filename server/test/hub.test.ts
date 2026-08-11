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
})
