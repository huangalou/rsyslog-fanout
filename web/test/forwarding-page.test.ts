import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
const gets: Record<string, unknown> = {
  '/api/inputs': [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }],
  '/api/destinations': [{ id: 1, name: 'arcsight', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true }],
  '/api/routes': [], '/api/config/status': { dirty: true, lastResult: null },
}
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async (u: string) => gets[u]), post: vi.fn(async () => ({ applied: true })), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
import Forwarding from '../src/pages/Forwarding.vue'
import { api } from '../src/api/client'

describe('Forwarding page', () => {
  it('矩陣勾選建立 route', async () => {
    const w = mount(Forwarding, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="cell-1-1"] input[type=checkbox]').setValue(true)
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/routes', expect.objectContaining({ inputId: 1, destinationId: 1 }))
  })
  it('套用按鈕呼叫 config/apply', async () => {
    const w = mount(Forwarding, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/config/apply', undefined)
  })
})
