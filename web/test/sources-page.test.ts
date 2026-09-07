import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Snapshot } from '../src/stores/stats'

const NOW = new Date('2026-09-07T12:00:00Z').getTime()
let overview: Snapshot & { tail: unknown[] }
vi.mock('../src/api/client', () => ({
  api: {
    get: vi.fn(async (u: string) => (u === '/api/stats/overview' ? overview : { dirty: false })),
    post: vi.fn(), put: vi.fn(), del: vi.fn(),
  },
  setUnauthorizedHandler: vi.fn(),
}))
vi.mock('../src/api/ws', () => ({ connectWs: vi.fn(() => vi.fn()) }))
import Sources from '../src/pages/Sources.vue'
import { connectWs } from '../src/api/ws'

const source = (ip: string, agoMs: number, stale = false) => ({ ip, lastSeen: NOW - agoMs, stale })

beforeEach(() => {
  // 只假 Date 與 interval：flushPromises 依賴的 setImmediate/setTimeout 保持真實，避免掛住
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  overview = { inputs: {}, actions: {}, sources: [], tail: [] }
  vi.mocked(connectWs).mockClear()
})
afterEach(() => vi.useRealTimers())

const mountSources = async () => {
  const w = mount(Sources, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return w
}

describe('Sources page', () => {
  it('無來源時顯示空狀態文字', async () => {
    const w = await mountSources()
    expect(w.text()).toContain('尚無來源資料')
  })

  it('列出來源並依 lastSeen 新到舊排序', async () => {
    overview.sources = [source('10.0.0.1', 60_000), source('10.0.0.2', 5_000)]
    const w = await mountSources()
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('10.0.0.2')
    expect(rows[1].text()).toContain('10.0.0.1')
    expect(w.text()).not.toContain('尚無來源資料')
  })

  it('相對時間依秒/分/時/天分級顯示', async () => {
    overview.sources = [
      source('s', 5_000),
      source('m', 3 * 60_000),
      source('h', 2 * 3_600_000),
      source('d', 3 * 86_400_000),
    ]
    const w = await mountSources()
    const text = w.text()
    expect(text).toContain('5 秒前')
    expect(text).toContain('3 分鐘前')
    expect(text).toContain('2 小時前')
    expect(text).toContain('3 天前')
  })

  it('lastSeen 在未來（時鐘偏差）時不顯示負數', async () => {
    overview.sources = [source('f', -30_000)]
    const w = await mountSources()
    expect(w.text()).toContain('0 秒前')
  })

  it('stale 來源顯示「疑似斷訊」徽章，正常來源顯示「正常」', async () => {
    overview.sources = [source('10.0.0.1', 1_000), source('10.0.0.2', 900_000, true)]
    const w = await mountSources()
    expect(w.findAll('[data-test="stale-badge"]')).toHaveLength(1)
    expect(w.text()).toContain('疑似斷訊')
    expect(w.text()).toContain('正常')
  })

  it('每秒更新 now，相對時間持續走動', async () => {
    overview.sources = [source('10.0.0.1', 59_000)]
    const w = await mountSources()
    expect(w.text()).toContain('59 秒前')
    vi.advanceTimersByTime(2_000)
    await flushPromises()
    expect(w.text()).toContain('1 分鐘前')
  })

  it('卸載時停止 stats 訂閱與計時器', async () => {
    const w = await mountSources()
    const stopWs = vi.mocked(connectWs).mock.results[0]?.value as ReturnType<typeof vi.fn>
    expect(stopWs).toBeDefined()
    w.unmount()
    expect(stopWs).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
