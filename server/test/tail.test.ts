import { describe, it, expect, vi } from 'vitest'
import { createTailListener } from '../src/monitor/tail.js'
import { createHub } from '../src/monitor/hub.js'

const pkt = (i: number) => Buffer.from(JSON.stringify({ src: '10.0.0.9', input: 1, fac: 16, sev: 6, msg: `m${i}` }))

describe('tail listener', () => {
  it('datagram 解析後進 ring、emitTail、更新來源', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const seen: string[] = []
    hub.onTail((m) => seen.push(m.msg))
    const t = createTailListener(hub, { port: 0, ringSize: 3 })
    t.handleDatagram(pkt(1))
    expect(seen).toEqual(['m1'])
    expect(hub.snapshot().sources[0].ip).toBe('10.0.0.9')
  })
  it('ring 超過容量丟最舊', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const t = createTailListener(hub, { port: 0, ringSize: 3 })
    for (let i = 1; i <= 5; i++) t.handleDatagram(pkt(i))
    expect(t.ring().map((m) => m.msg)).toEqual(['m3', 'm4', 'm5'])
  })
  it('超過每秒上限的訊息被丟棄', () => {
    vi.useFakeTimers()
    const hub = createHub({ staleAfterMs: 600000 })
    const t = createTailListener(hub, { port: 0, ringSize: 10, maxPerSec: 2 })
    for (let i = 1; i <= 5; i++) t.handleDatagram(pkt(i))
    expect(t.ring()).toHaveLength(2)
    vi.advanceTimersByTime(1000)
    t.handleDatagram(pkt(6))
    expect(t.ring()).toHaveLength(3)
    vi.useRealTimers()
  })
  it('壞 JSON 靜默丟棄', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const t = createTailListener(hub, { port: 0 })
    t.handleDatagram(Buffer.from('garbage'))
    expect(t.ring()).toHaveLength(0)
  })
})
