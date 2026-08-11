import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextBackoff, connectWs } from '../src/api/ws'

describe('nextBackoff', () => {
  it('1s 起每次翻倍、上限 30s', () => {
    expect(nextBackoff(0)).toBe(1000)
    expect(nextBackoff(1000)).toBe(2000)
    expect(nextBackoff(16000)).toBe(30000)
    expect(nextBackoff(30000)).toBe(30000)
  })
})

// zombie socket 修正：disconnect 後不應再建立新的 WebSocket。
// jsdom 沒有真的 WebSocket 網路行為，這裡用最小的假 WebSocket 類別
// 手動觸發 onclose，驗證 connectWs 內部的兩道防線各自生效。
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  close(): void {
    this.onclose?.()
  }
}

describe('connectWs 重連保護（防止 zombie socket）', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('disconnect 會清除排程中的重連 timer，時間到也不會建立新 socket', () => {
    const disconnect = connectWs({})
    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0].onclose?.() // 模擬非預期斷線，排程重連（delay=1000）
    disconnect()
    vi.advanceTimersByTime(30000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('open() 入口檢查 closed：即使排程的 callback 仍被觸發也不會重連', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const disconnect = connectWs({})
    FakeWebSocket.instances[0].onclose?.() // 排程重連
    const scheduledOpen = setTimeoutSpy.mock.calls.at(-1)?.[0] as () => void
    disconnect() // 設定 closed = true
    scheduledOpen() // 直接呼叫排程函式本身，模擬 clearTimeout 未生效的極端情況
    expect(FakeWebSocket.instances).toHaveLength(1) // open() 入口的 closed 檢查擋下新連線
  })
})
