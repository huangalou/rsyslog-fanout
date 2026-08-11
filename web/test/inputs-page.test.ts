import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async () => [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }]), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))
import Inputs from '../src/pages/Inputs.vue'
import { api, ApiError } from '../src/api/client'

beforeEach(() => {
  vi.mocked(api.get).mockClear()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.del).mockReset()
})

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

  it('點編輯後帶入現值並送出呼叫 PUT /api/inputs/:id', async () => {
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="edit"]').trigger('click')
    expect((w.find('[data-test="name"]').element as HTMLInputElement).value).toBe('net')
    expect((w.find('[data-test="port"]').element as HTMLInputElement).value).toBe('514')
    await w.find('[data-test="name"]').setValue('net-renamed')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/inputs/1', expect.objectContaining({ name: 'net-renamed', port: 514 }))
  })

  it('點刪除經 confirm() 確認後呼叫 DELETE /api/inputs/:id', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="delete"]').trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/api/inputs/1')
  })

  it('confirm() 取消時不呼叫 DELETE', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="delete"]').trigger('click')
    await flushPromises()
    expect(api.del).not.toHaveBeenCalled()
  })

  it('新增失敗（如埠號超界）時於表單上方以 role=alert 顯示錯誤訊息', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError('埠號 70000 不在允許範圍（FANOUT_PORT_RANGE=514...）', 400))
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="add"]').trigger('click')
    await w.find('[data-test="name"]').setValue('n2')
    await w.find('[data-test="port"]').setValue('70000')
    await w.find('form').trigger('submit')
    await flushPromises()
    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('允許範圍')
  })
})
