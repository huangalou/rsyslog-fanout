import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { WsHandlers } from '../src/api/ws'
import type { TailMsg } from '../src/stores/tail'

vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async () => [{ id: 1, name: 'net' }, { id: 2, name: 'fw' }]), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
let handlers: WsHandlers | null = null
const stopWs = vi.fn()
vi.mock('../src/api/ws', () => ({
  connectWs: vi.fn((h: WsHandlers) => {
    handlers = h
    return stopWs
  }),
}))
import LiveTail from '../src/pages/LiveTail.vue'
import { api } from '../src/api/client'
import { connectWs } from '../src/api/ws'

const msg = (over: Partial<TailMsg> = {}): TailMsg =>
  ({ src: '10.0.0.9', input: 1, fac: 16, sev: 6, msg: 'hello', ts: Date.UTC(2026, 8, 7, 12, 0, 0), ...over })

beforeEach(() => {
  handlers = null
  stopWs.mockClear()
  vi.mocked(connectWs).mockClear()
  vi.mocked(api.get).mockClear()
})

const mountTail = async () => {
  const w = mount(LiveTail, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return w
}
const pushLines = async (...lines: TailMsg[]) => {
  for (const l of lines) handlers?.onTail?.(l)
  await flushPromises()
}

describe('LiveTail page', () => {
  it('掛載後載入 inputs 供過濾選單並連上 WS', async () => {
    const w = await mountTail()
    expect(api.get).toHaveBeenCalledWith('/api/inputs')
    expect(connectWs).toHaveBeenCalledTimes(1)
    const options = w.findAll('[data-test="filter-input"] option').map((o) => o.text())
    expect(options).toEqual(['（全部）', 'net', 'fw'])
    expect(w.text()).toContain('尚無訊息')
  })

  it('WS tail 訊息即時顯示：來源、input 名稱、嚴重度標籤與內文', async () => {
    const w = await mountTail()
    await pushLines(msg({ sev: 3, msg: 'disk failure' }))
    const line = w.find('.tail-line')
    expect(line.find('.src').text()).toBe('10.0.0.9')
    expect(line.find('.input').text()).toBe('net')
    expect(line.find('.sev-badge').text()).toBe('err')
    expect(line.find('.sev-badge').classes()).toContain('sev-danger')
    expect(line.find('.msg').text()).toBe('disk failure')
    expect(line.find('.ts').text()).not.toBe('')
  })

  it('嚴重度分級：≤3 danger、4 warn、≥5 ok；未知 input 以 #id 顯示', async () => {
    const w = await mountTail()
    await pushLines(msg({ sev: 0 }), msg({ sev: 4 }), msg({ sev: 7, input: 99 }))
    const badges = w.findAll('.sev-badge')
    expect(badges[0].classes()).toContain('sev-danger')
    expect(badges[0].text()).toBe('emerg')
    expect(badges[1].classes()).toContain('sev-warn')
    expect(badges[2].classes()).toContain('sev-ok')
    expect(badges[2].text()).toBe('debug')
    expect(w.findAll('.input')[2].text()).toBe('#99')
  })

  it('選擇過濾來源後只顯示該 input 的訊息，改回（全部）恢復', async () => {
    const w = await mountTail()
    await pushLines(msg({ input: 1, msg: 'from-net' }), msg({ input: 2, msg: 'from-fw' }))
    await w.find('[data-test="filter-input"]').setValue('2')
    expect(w.findAll('.tail-line').map((l) => l.find('.msg').text())).toEqual(['from-fw'])
    await w.find('[data-test="filter-input"]').setValue('')
    expect(w.findAll('.tail-line')).toHaveLength(2)
  })

  it('暫停後畫面凍結、按鈕改為「繼續」；繼續後補顯示累積訊息', async () => {
    const w = await mountTail()
    await pushLines(msg({ msg: 'a' }))
    const btn = w.find('[data-test="pause-toggle"]')
    expect(btn.text()).toBe('暫停')
    await btn.trigger('click')
    expect(btn.text()).toBe('繼續')
    await pushLines(msg({ msg: 'b' }))
    expect(w.findAll('.tail-line')).toHaveLength(1)
    await btn.trigger('click')
    expect(w.findAll('.tail-line')).toHaveLength(2)
  })

  it('卸載時關閉 WS', async () => {
    const w = await mountTail()
    w.unmount()
    expect(stopWs).toHaveBeenCalledTimes(1)
  })

  it('inputs 載入完成前就卸載：不建立 WS 連線（避免無人能取消的洩漏）', async () => {
    let resolveInputs: (v: unknown) => void = () => {}
    vi.mocked(api.get).mockReturnValueOnce(new Promise((r) => { resolveInputs = r }))
    const w = mount(LiveTail, { global: { plugins: [createPinia()] } })
    w.unmount()
    resolveInputs([])
    await flushPromises()
    expect(connectWs).not.toHaveBeenCalled()
  })

  it('inputs 載入失敗時仍可運作，選單僅剩（全部）', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'))
    const w = await mountTail()
    expect(w.findAll('[data-test="filter-input"] option')).toHaveLength(1)
    expect(connectWs).toHaveBeenCalledTimes(1)
  })
})
