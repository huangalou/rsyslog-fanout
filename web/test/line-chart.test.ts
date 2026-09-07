import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LineChart from '../src/components/LineChart.vue'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})

describe('LineChart', () => {
  it('無資料點時顯示空狀態而非 SVG', () => {
    const w = mount(LineChart, { props: { points: [] } })
    expect(w.find('svg').exists()).toBe(false)
    expect(w.text()).toContain('尚無資料')
  })

  it('有資料點時繪出折線與面積，並帶無障礙標籤', async () => {
    const w = mount(LineChart, { props: { points: [{ ts: 1000, v: 0 }, { ts: 2000, v: 10 }] } })
    await w.vm.$nextTick()
    const svg = w.find('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('流量走勢圖')
    const line = w.find('polyline').attributes('points')!
    const coords = line.split(' ').map((p) => p.split(',').map(Number))
    expect(coords).toHaveLength(2)
    expect(coords[0][0]).toBe(12)          // 最早點貼左內距
    expect(coords[1][0]).toBe(628)         // 最晚點貼右內距
    expect(coords[0][1]).toBeGreaterThan(coords[1][1])  // v 越大 y 越小（SVG 座標向下）
    expect(w.find('polygon').attributes('points')).toContain(line)
  })

  it('單一資料點不會除以零，仍可繪製', () => {
    const w = mount(LineChart, { props: { points: [{ ts: 5, v: 0 }] } })
    const pts = w.find('polyline').attributes('points')!
    expect(pts).not.toContain('NaN')
  })

  it('掛載後於下一個動畫幀加上 visible（淡入僅動 opacity）', async () => {
    const w = mount(LineChart, { props: { points: [{ ts: 1, v: 1 }, { ts: 2, v: 2 }] } })
    await w.vm.$nextTick()
    expect(w.find('polyline').classes()).toContain('visible')
    expect(w.find('polygon').classes()).toContain('visible')
  })
})
