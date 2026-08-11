import { readFileSync, statSync } from 'node:fs'
import type { HubInternals } from './hub.js'

export interface ImpstatsEntry { name: string; origin: string; values: Record<string, number> }

export function parseImpstatsLine(line: string): ImpstatsEntry | null {
  try {
    const o = JSON.parse(line)
    if (typeof o.name !== 'string' || typeof o.origin !== 'string') return null
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') values[k] = v
    return { name: o.name, origin: o.origin, values }
  } catch { return null }
}

const prevSubmitted = new Map<string, number>()
const IMUDP_RE = /^im(udp|tcp)\(\*:(\d+)\)$/

export function applyEntries(hub: HubInternals, entries: ImpstatsEntry[], intervalSec: number): void {
  const queueSizes = new Map<string, number>()
  for (const e of entries) {
    if (e.origin === 'core.queue') queueSizes.set(e.name.replace(/ queue$/, ''), e.values.size ?? 0)
  }
  for (const e of entries) {
    const m = IMUDP_RE.exec(e.name)
    if (m) {
      const key = `${m[1]}:${m[2]}`
      const prev = prevSubmitted.get(key)
      const submitted = e.values.submitted ?? 0
      const rate = prev === undefined ? 0 : Math.max(0, (submitted - prev) / intervalSec)
      prevSubmitted.set(key, submitted)
      hub.setInput(key, submitted, rate)
    } else if (e.origin === 'core.action') {
      hub.setAction(e.name, {
        processed: e.values.processed ?? 0, failed: e.values.failed ?? 0,
        suspended: (e.values.suspended ?? 0) > 0, queueSize: queueSizes.get(e.name) ?? 0,
      })
    }
  }
  hub.emitStats()
}

export function createImpstatsReader(path: string, hub: HubInternals, intervalMs = 10000) {
  let offset = 0
  let timer: NodeJS.Timeout | null = null
  const tick = () => {
    try {
      const size = statSync(path).size
      if (size < offset) offset = 0            // 檔案被 rotate/truncate
      if (size === offset) return
      const text = readFileSync(path, 'utf8').slice(offset)
      offset = size
      const entries = text.split('\n').map(parseImpstatsLine).filter((e): e is ImpstatsEntry => e !== null)
      if (entries.length) applyEntries(hub, entries, intervalMs / 1000)
    } catch { /* 檔案尚未存在：rsyslog 未啟動前屬正常，靜默略過 */ }
  }
  return { start: () => { timer = setInterval(tick, intervalMs); tick() }, stop: () => { if (timer) clearInterval(timer) } }
}
