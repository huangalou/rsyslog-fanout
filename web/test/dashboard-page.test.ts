import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Snapshot } from '../src/stores/stats'

let overview: Snapshot & { tail: unknown[] }
let status: { dirty: boolean }
vi.mock('../src/api/client', () => ({
  api: {
    get: vi.fn(async (u: string) => (u === '/api/stats/overview' ? overview : status)),
    post: vi.fn(), put: vi.fn(), del: vi.fn(),
  },
  setUnauthorizedHandler: vi.fn(),
}))
vi.mock('../src/api/ws', () => ({ connectWs: vi.fn(() => vi.fn()) }))
import Dashboard from '../src/pages/Dashboard.vue'
import { connectWs } from '../src/api/ws'

// Dashboard 的 dirty banner 是 RouterLink；以最小 stub 取代避免掛整個 router
const RouterLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }
const action = (over: Partial<Snapshot['actions'][string]> = {}) => ({ processed: 10, failed: 0, suspended: false, queueSize: 0, ...over })

beforeEach(() => {
  overview = { inputs: {}, actions: {}, sources: [], tail: [] }
  status = { dirty: false }
  vi.mocked(connectWs).mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})

const mountDashboard = async () => {
  const w = mount(Dashboard, { global: { plugins: [createPinia()], stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  return w
}

describe('Dashboard page', () => {
  it('無 input/action 時顯示兩段空狀態', async () => {
    const w = await mountDashboard()
    expect(w.text()).toContain('尚無接收來源')
    expect(w.text()).toContain('尚無轉發目的地')
  })

  it('每個 input 一張卡：速率一位小數與累計量', async () => {
    overview.inputs = { 'udp:514': { submitted: 1234, rate: 5.25 }, 'tcp:5140': { submitted: 7, rate: 0 } }
    const w = await mountDashboard()
    const cards = w.findAll('.status-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('udp:514')
    expect(cards[0].text()).toContain('5.3/s')
    expect(cards[0].text()).toContain('累計 1234')
    expect(cards[0].classes()).toContain('state-ok')
  })

  it('action 卡狀態：正常 ok、佇列超過 1000 warn、suspended danger', async () => {
    overview.actions = {
      d1_i1: action(),
      d2_i1: action({ queueSize: 1500 }),
      d3_i1: action({ suspended: true, queueSize: 5000 }),
    }
    const w = await mountDashboard()
    const cards = w.findAll('.status-card')
    expect(cards[0].classes()).toContain('state-ok')
    expect(cards[1].classes()).toContain('state-warn')
    expect(cards[2].classes()).toContain('state-danger')
    expect(cards[1].text()).toContain('佇列 1500')
  })

  it('佇列剛好 1000 仍為 ok（門檻為嚴格大於）', async () => {
    overview.actions = { d1_i1: action({ queueSize: 1000 }) }
    const w = await mountDashboard()
    expect(w.find('.status-card').classes()).toContain('state-ok')
  })

  it('config 有未套用變更時顯示導向 /forwarding 的 banner', async () => {
    status = { dirty: true }
    const w = await mountDashboard()
    const banner = w.find('[role="status"] a')
    expect(banner.exists()).toBe(true)
    expect(banner.attributes('href')).toBe('/forwarding')
  })

  it('無未套用變更時不顯示 banner', async () => {
    const w = await mountDashboard()
    expect(w.find('[role="status"]').exists()).toBe(false)
  })

  it('載入首筆快照後速率圖以 SVG 呈現', async () => {
    overview.inputs = { 'udp:514': { submitted: 1, rate: 3 } }
    const w = await mountDashboard()
    expect(w.find('svg[role="img"]').exists()).toBe(true)
  })

  it('卸載時關閉 WS 訂閱', async () => {
    const w = await mountDashboard()
    const stopWs = vi.mocked(connectWs).mock.results[0]?.value as ReturnType<typeof vi.fn>
    w.unmount()
    expect(stopWs).toHaveBeenCalled()
  })
})
