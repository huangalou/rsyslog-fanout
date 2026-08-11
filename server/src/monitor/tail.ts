import { createSocket } from 'node:dgram'
import type { HubInternals, TailMsg } from './hub.js'

export function createTailListener(
  hub: HubInternals,
  opts: { port: number; ringSize?: number; maxPerSec?: number },
) {
  const ringSize = opts.ringSize ?? 1000
  const maxPerSec = opts.maxPerSec ?? 500
  const ring: TailMsg[] = []
  let windowStart = 0
  let windowCount = 0
  const sock = createSocket('udp4')

  function handleDatagram(buf: Buffer): void {
    const now = Date.now()
    if (now - windowStart >= 1000) {
      windowStart = now
      windowCount = 0
    }
    if (windowCount >= maxPerSec) return
    let parsed: unknown
    try {
      parsed = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    const p = parsed as Record<string, unknown>
    if (typeof p.src !== 'string' || typeof p.msg !== 'string') return
    windowCount++
    const m: TailMsg = { src: p.src, input: Number(p.input), fac: Number(p.fac), sev: Number(p.sev), msg: p.msg, ts: now }
    ring.push(m)
    if (ring.length > ringSize) ring.shift()
    hub.seenSource(m.src, now)
    hub.emitTail(m)
  }

  sock.on('message', handleDatagram)
  return {
    handleDatagram,
    ring: () => [...ring],
    start: () => new Promise<void>((res) => sock.bind(opts.port, '127.0.0.1', res)),
    stop: () => sock.close(),
  }
}
