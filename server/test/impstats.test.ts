import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseImpstatsLine, applyEntries, createImpstatsReader } from '../src/monitor/impstats.js'
import { createHub } from '../src/monitor/hub.js'

const inputLine = '{ "name": "imudp(*:514)", "origin": "imudp", "submitted": 100 }'
const actionLine = '{ "name": "d1_i1", "origin": "core.action", "processed": 90, "failed": 2, "suspended": 1 }'
const queueLine = '{ "name": "d1_i1 queue", "origin": "core.queue", "size": 5 }'

describe('parseImpstatsLine', () => {
  it('解析 imudp 統計', () => {
    expect(parseImpstatsLine(inputLine)).toEqual({ name: 'imudp(*:514)', origin: 'imudp', values: { submitted: 100 } })
  })
  it('非 JSON 行回 null', () => expect(parseImpstatsLine('not json')).toBeNull())
})

describe('applyEntries → snapshot', () => {
  it('input/action/queue 統計整合進 snapshot，rate 依差值計算', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    applyEntries(hub, [inputLine, actionLine, queueLine].map((l) => parseImpstatsLine(l)!), 10)
    applyEntries(hub, [parseImpstatsLine('{ "name": "imudp(*:514)", "origin": "imudp", "submitted": 150 }')!], 10)
    const s = hub.snapshot()
    expect(s.inputs['udp:514'].submitted).toBe(150)
    expect(s.inputs['udp:514'].rate).toBe(5)          // (150-100)/10s
    expect(s.actions['d1_i1']).toEqual({ processed: 90, failed: 2, suspended: true, queueSize: 5 })
  })
  it('snapshot 更新時通知 onStats 訂閱者', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    let called = 0
    const off = hub.onStats(() => called++)
    applyEntries(hub, [parseImpstatsLine(inputLine)!], 10)
    expect(called).toBe(1)
    off()
    applyEntries(hub, [parseImpstatsLine(inputLine)!], 10)
    expect(called).toBe(1)
  })
})

describe('createImpstatsReader', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impstats-test-'))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('檔案不存在時靜默略過，不拋錯', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const reader = createImpstatsReader(join(dir, 'does-not-exist.log'), hub, 50)
    expect(() => reader.start()).not.toThrow()
    expect(hub.snapshot().inputs).toEqual({})
    reader.stop()
  })

  it('讀取新增行並前進 offset，重複 tick 無新內容不重複套用', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    let statsCalls = 0
    hub.onStats(() => statsCalls++)
    const path = join(dir, 'stats.log')
    writeFileSync(path, '{ "name": "imtcp(*:6514)", "origin": "imtcp", "submitted": 10 }\n')
    const reader = createImpstatsReader(path, hub, 50)
    reader.start() // 立即執行一次 tick
    expect(hub.snapshot().inputs['tcp:6514'].submitted).toBe(10)
    expect(statsCalls).toBe(1)

    vi.advanceTimersByTime(50) // 無新內容，不應再次 emitStats
    expect(statsCalls).toBe(1)

    appendFileSync(path, '{ "name": "imtcp(*:6514)", "origin": "imtcp", "submitted": 20 }\n')
    vi.advanceTimersByTime(50)
    expect(hub.snapshot().inputs['tcp:6514'].submitted).toBe(20)
    expect(statsCalls).toBe(2)

    reader.stop()
    appendFileSync(path, '{ "name": "imtcp(*:6514)", "origin": "imtcp", "submitted": 30 }\n')
    vi.advanceTimersByTime(200)
    expect(statsCalls).toBe(2) // stop() 後不再讀取
  })

  it('檔案被 rotate/truncate 時 offset 歸零，重新從頭讀取', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const path = join(dir, 'rotate.log')
    writeFileSync(path, '{ "name": "imtcp(*:7514)", "origin": "imtcp", "submitted": 500 }\n')
    const reader = createImpstatsReader(path, hub, 50)
    reader.start()
    expect(hub.snapshot().inputs['tcp:7514'].submitted).toBe(500)

    // 模擬 logrotate：檔案被截斷並寫入較短的新內容
    writeFileSync(path, '{ "name": "imtcp(*:7514)", "origin": "imtcp", "submitted": 1 }\n')
    vi.advanceTimersByTime(50)
    expect(hub.snapshot().inputs['tcp:7514'].submitted).toBe(1)

    reader.stop()
  })
})
