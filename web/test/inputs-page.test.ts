import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async () => [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }]), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
import Inputs from '../src/pages/Inputs.vue'
import { api } from '../src/api/client'

describe('Inputs page', () => {
  it('載入後列出 input', async () => {
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('net')
    expect(w.text()).toContain('514')
  })
  it('送出新增表單呼叫 POST /api/inputs', async () => {
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="add"]').trigger('click')
    await w.find('[data-test="name"]').setValue('n2')
    await w.find('[data-test="port"]').setValue('5140')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/inputs', expect.objectContaining({ name: 'n2', port: 5140 }))
  })
})
