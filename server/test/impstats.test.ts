import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseImpstatsLine, applyEntries, createApplyState, createImpstatsReader } from '../src/monitor/impstats.js'
import { createHub } from '../src/monitor/hub.js'

const newState = createApplyState

// 行格式以實機 rsyslog 8（Alpine 容器）的 impstats log.file 輸出為準：
// 每行帶 `Fri Aug 14 22:08:27 2026: ` 時間戳前綴；
// UDP 監聽名稱為 imudp(*/<port>/IPv4|IPv6) 一埠兩條，TCP 為 imtcp(<port>)。
const udp4Line = 'Fri Aug 14 22:08:27 2026: { "name": "imudp(*\\/5160\\/IPv4)", "origin": "imudp", "submitted": 100, "disallowed": 0 }'
const udp6Line = 'Fri Aug 14 22:08:27 2026: { "name": "imudp(*\\/5160\\/IPv6)", "origin": "imudp", "submitted": 20, "disallowed": 0 }'
const tcpLine = 'Fri Aug 14 22:08:27 2026: { "name": "imtcp(5161)", "origin": "imtcp", "submitted": 7 }'
const workerLine = 'Fri Aug 14 22:08:27 2026: { "name": "imudp(w0)", "origin": "imudp", "called.recvmmsg": 690, "msgs.received": 345 }'
const actionLine = 'Fri Aug 14 22:08:27 2026: { "name": "d1_i1", "origin": "core.action", "processed": 90, "failed": 2, "suspended": 1 }'
const builtinActionLine = 'Fri Aug 14 22:08:27 2026: { "name": "action-4-builtin:omfwd", "origin": "core.action", "processed": 345, "failed": 0, "suspended": 0 }'
const queueLine = 'Fri Aug 14 22:08:27 2026: { "name": "d1_i1 queue", "origin": "core.queue", "size": 5 }'

describe('parseImpstatsLine', () => {
  it('解析帶時間戳前綴的實機輸出行', () => {
    expect(parseImpstatsLine(udp4Line)).toEqual({
      name: 'imudp(*/5160/IPv4)', origin: 'imudp', values: { submitted: 100, disallowed: 0 },
    })
  })
  it('無前綴的純 JSON 行仍可解析', () => {
    expect(parseImpstatsLine('{ "name": "imtcp(5161)", "origin": "imtcp", "submitted": 7 }'))
      .toEqual({ name: 'imtcp(5161)', origin: 'imtcp', values: { submitted: 7 } })
  })
  it('非 JSON 行回 null', () => expect(parseImpstatsLine('not json')).toBeNull())
})

describe('applyEntries → snapshot', () => {
  it('UDP 同埠 IPv4/IPv6 兩條目加總為單一 udp:<port>，rate 依差值計算', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const st = newState()
    applyEntries(hub, [udp4Line, udp6Line].map((l) => parseImpstatsLine(l)!), 10, st)
    applyEntries(hub, [
      parseImpstatsLine('Fri Aug 14 22:08:37 2026: { "name": "imudp(*\\/5160\\/IPv4)", "origin": "imudp", "submitted": 150, "disallowed": 0 }')!,
      parseImpstatsLine('Fri Aug 14 22:08:37 2026: { "name": "imudp(*\\/5160\\/IPv6)", "origin": "imudp", "submitted": 30, "disallowed": 0 }')!,
    ], 10, st)
    const s = hub.snapshot()
    expect(s.inputs['udp:5160'].submitted).toBe(180)   // 150 + 30
    expect(s.inputs['udp:5160'].rate).toBe(6)          // (180-120)/10s
  })
  it('同一 batch 含同名條目多個時間快照時取最後一筆（累計計數器語意），不跨時間加總', () => {
    // 情境：server 重啟後 reader 從頭讀整個 impstats 檔，一個 batch 內
    // 會有同一監聽器每 10 秒一筆的歷史快照。
    const hub = createHub({ staleAfterMs: 600000 })
    const st = newState()
    applyEntries(hub, [
      parseImpstatsLine('Fri Aug 14 22:08:17 2026: { "name": "imudp(*\\/5170\\/IPv4)", "origin": "imudp", "submitted": 100 }')!,
      parseImpstatsLine('Fri Aug 14 22:08:17 2026: { "name": "imudp(*\\/5170\\/IPv6)", "origin": "imudp", "submitted": 20 }')!,
      parseImpstatsLine('Fri Aug 14 22:08:27 2026: { "name": "imudp(*\\/5170\\/IPv4)", "origin": "imudp", "submitted": 150 }')!,
      parseImpstatsLine('Fri Aug 14 22:08:27 2026: { "name": "imudp(*\\/5170\\/IPv6)", "origin": "imudp", "submitted": 30 }')!,
    ], 10, st)
    expect(hub.snapshot().inputs['udp:5170'].submitted).toBe(180)  // 最後快照 150+30，而非 100+20+150+30
  })
  it('TCP 監聽 imtcp(<port>) 對映為 tcp:<port>', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    applyEntries(hub, [parseImpstatsLine(tcpLine)!], 10, newState())
    expect(hub.snapshot().inputs['tcp:5161'].submitted).toBe(7)
  })
  it('imudp worker 條目（imudp(w0)）不會誤入 inputs', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    applyEntries(hub, [parseImpstatsLine(workerLine)!], 10, newState())
    expect(hub.snapshot().inputs).toEqual({})
  })
  it('路由 action（d/i 命名）納入統計並整合 queue size', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    applyEntries(hub, [actionLine, queueLine].map((l) => parseImpstatsLine(l)!), 10, newState())
    expect(hub.snapshot().actions['d1_i1']).toEqual({ processed: 90, failed: 2, suspended: true, queueSize: 5 })
  })
  it('內部 builtin action（tail 轉發）不納入 actions', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    applyEntries(hub, [parseImpstatsLine(builtinActionLine)!], 10, newState())
    expect(hub.snapshot().actions).toEqual({})
  })
  it('各自的 state 互不污染：同一 key 在不同 state 下 rate 獨立計算', () => {
    const hubA = createHub({ staleAfterMs: 600000 })
    const hubB = createHub({ staleAfterMs: 600000 })
    const stA = newState()
    const stB = newState()
    applyEntries(hubA, [parseImpstatsLine(udp4Line)!], 10, stA)   // A 建立基準 100
    applyEntries(hubB, [parseImpstatsLine(udp4Line)!], 10, stB)   // B 首次觀測，不受 A 基準影響
    expect(hubB.snapshot().inputs['udp:5160'].rate).toBe(0)
    applyEntries(hubB, [
      parseImpstatsLine('Fri Aug 14 22:08:37 2026: { "name": "imudp(*\\/5160\\/IPv4)", "origin": "imudp", "submitted": 200 }')!,
    ], 10, stB)
    expect(hubB.snapshot().inputs['udp:5160'].rate).toBe(10)      // (200-100)/10s，基準來自 stB 而非 stA
  })
  it('計數器倒退（rsyslogd 重啟歸零）時 rate clamp 為 0，下一輪以新基準恢復', () => {
    // Apply 會重啟 rsyslogd，行程內計數器歸零重算，submitted 從高值掉到低值屬正常流程
    const hub = createHub({ staleAfterMs: 600000 })
    const st = newState()
    const line = (n: number) => parseImpstatsLine(`Fri Aug 14 22:08:27 2026: { "name": "imtcp(5161)", "origin": "imtcp", "submitted": ${n} }`)!
    applyEntries(hub, [line(500)], 10, st)
    applyEntries(hub, [line(30)], 10, st)                          // 重啟後歸零重算
    expect(hub.snapshot().inputs['tcp:5161'].rate).toBe(0)         // 不得出現負速率
    applyEntries(hub, [line(80)], 10, st)
    expect(hub.snapshot().inputs['tcp:5161'].rate).toBe(5)         // (80-30)/10s，基準已更新為 30
  })
  it('batch 含監聽 origin 條目但全部未命中名稱格式時告警一次，之後不重複', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const st = newState()
    const warn = vi.fn()
    const unknownFormat = parseImpstatsLine('{ "name": "imudp(0.0.0.0:514)", "origin": "imudp", "submitted": 5 }')!
    applyEntries(hub, [unknownFormat], 10, st, warn)
    expect(warn).toHaveBeenCalledTimes(1)
    applyEntries(hub, [unknownFormat], 10, st, warn)
    expect(warn).toHaveBeenCalledTimes(1)                          // rate-limited：同一 state 只警告一次
  })
  it('worker-only 或正常命中的 batch 不觸發告警', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const warn = vi.fn()
    applyEntries(hub, [parseImpstatsLine(workerLine)!], 10, newState(), warn)
    applyEntries(hub, [parseImpstatsLine(udp4Line)!], 10, newState(), warn)
    expect(warn).not.toHaveBeenCalled()
  })
  it('snapshot 更新時通知 onStats 訂閱者', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    let called = 0
    const st = newState()
    const off = hub.onStats(() => called++)
    applyEntries(hub, [parseImpstatsLine(udp4Line)!], 10, st)
    expect(called).toBe(1)
    off()
    applyEntries(hub, [parseImpstatsLine(udp4Line)!], 10, st)
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

  const tcpFileLine = (port: number, submitted: number) =>
    `Fri Aug 14 22:08:27 2026: { "name": "imtcp(${port})", "origin": "imtcp", "submitted": ${submitted} }\n`

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
    writeFileSync(path, tcpFileLine(6514, 10))
    const reader = createImpstatsReader(path, hub, 50)
    reader.start() // 立即執行一次 tick
    expect(hub.snapshot().inputs['tcp:6514'].submitted).toBe(10)
    expect(statsCalls).toBe(1)

    vi.advanceTimersByTime(50) // 無新內容，不應再次 emitStats
    expect(statsCalls).toBe(1)

    appendFileSync(path, tcpFileLine(6514, 20))
    vi.advanceTimersByTime(50)
    expect(hub.snapshot().inputs['tcp:6514'].submitted).toBe(20)
    expect(statsCalls).toBe(2)

    reader.stop()
    appendFileSync(path, tcpFileLine(6514, 30))
    vi.advanceTimersByTime(200)
    expect(statsCalls).toBe(2) // stop() 後不再讀取
  })

  it('檔案被 rotate/truncate 時 offset 歸零，重新從頭讀取', () => {
    const hub = createHub({ staleAfterMs: 600000 })
    const path = join(dir, 'rotate.log')
    writeFileSync(path, tcpFileLine(7514, 500))
    const reader = createImpstatsReader(path, hub, 50)
    reader.start()
    expect(hub.snapshot().inputs['tcp:7514'].submitted).toBe(500)

    // 模擬 logrotate：檔案被截斷並寫入較短的新內容
    writeFileSync(path, tcpFileLine(7514, 1))
    vi.advanceTimersByTime(50)
    expect(hub.snapshot().inputs['tcp:7514'].submitted).toBe(1)

    reader.stop()
  })
})
