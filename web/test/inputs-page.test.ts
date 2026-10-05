import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
const certReady = {
  dir: '/data/tls', customCa: false,
  serverCert: { ready: true, certPresent: true, keyPresent: true, subject: 'CN=fanout.test', altNames: 'DNS:fanout.test', notAfter: '2126-09-11T08:04:00.000Z', expired: false },
}
const certMissing = {
  dir: '/data/tls', customCa: false,
  serverCert: { ready: false, certPresent: false, keyPresent: false, subject: null, altNames: null, notAfter: null, expired: null },
}
const gets: Record<string, unknown> = {
  '/api/inputs': [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true, tls: false }],
  '/api/tls/status': certReady,
}
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(async (u: string) => gets[u]), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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
  gets['/api/inputs'] = [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true, tls: false }]
  gets['/api/tls/status'] = certReady
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockImplementation(async (u: string) => gets[u] as never)
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

describe('Inputs page：TLS', () => {
  const openAddForm = async () => {
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="add"]').trigger('click')
    await w.find('[data-test="name"]').setValue('tls-in')
    await w.find('[data-test="port"]').setValue('5140')
    return w
  }
  const tlsBox = (w: Awaited<ReturnType<typeof openAddForm>>) => w.find('[data-test="tls"]')

  it('協定為 udp 時 TLS 勾選停用，送出的 tls 為 false', async () => {
    const w = await openAddForm()
    expect((tlsBox(w).element as HTMLInputElement).disabled).toBe(true)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/inputs', expect.objectContaining({ protocol: 'udp', tls: false }))
  })

  it('選 tcp 並勾選 TLS 後送出 tls: true', async () => {
    const w = await openAddForm()
    await w.find('[data-test="protocol"]').setValue('tcp')
    expect((tlsBox(w).element as HTMLInputElement).disabled).toBe(false)
    await tlsBox(w).setValue(true)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/inputs', expect.objectContaining({ protocol: 'tcp', tls: true }))
  })

  it('勾選 TLS 後把協定切回 udp，TLS 自動取消', async () => {
    const w = await openAddForm()
    await w.find('[data-test="protocol"]').setValue('tcp')
    await tlsBox(w).setValue(true)
    await w.find('[data-test="protocol"]').setValue('udp')
    expect((tlsBox(w).element as HTMLInputElement).checked).toBe(false)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/inputs', expect.objectContaining({ protocol: 'udp', tls: false }))
  })

  it('編輯既有的 TLS input 時帶入勾選狀態', async () => {
    gets['/api/inputs'] = [{ id: 7, name: 'secure', protocol: 'tcp', port: 5140, enabled: true, tls: true }]
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('[data-test="edit"]').trigger('click')
    expect((tlsBox(w).element as HTMLInputElement).checked).toBe(true)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/inputs/7', expect.objectContaining({ tls: true }))
  })

  it('列表以 TLS 欄標示哪些 input 啟用了 TLS', async () => {
    gets['/api/inputs'] = [
      { id: 1, name: 'plain', protocol: 'tcp', port: 5140, enabled: true, tls: false },
      { id: 2, name: 'secure', protocol: 'tcp', port: 5141, enabled: true, tls: true },
    ]
    const w = mount(Inputs, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.findAll('[data-test="tls-on"]')).toHaveLength(1)
  })

  it('勾選 TLS 且伺服器憑證就緒：顯示憑證主體，不顯示警告', async () => {
    const w = await openAddForm()
    await w.find('[data-test="protocol"]').setValue('tcp')
    await tlsBox(w).setValue(true)
    expect(w.find('[data-test="tls-cert-info"]').text()).toContain('CN=fanout.test')
    expect(w.find('[data-test="tls-cert-warning"]').exists()).toBe(false)
  })

  it('勾選 TLS 但伺服器憑證未就緒：顯示警告並指出要放檔的目錄', async () => {
    gets['/api/tls/status'] = certMissing
    const w = await openAddForm()
    await w.find('[data-test="protocol"]').setValue('tcp')
    await tlsBox(w).setValue(true)
    const warning = w.find('[data-test="tls-cert-warning"]')
    expect(warning.attributes('role')).toBe('alert')
    expect(warning.text()).toContain('/data/tls')
    expect(warning.text()).toContain('cert.pem')
  })

  it('憑證已過期：顯示警告', async () => {
    gets['/api/tls/status'] = { ...certReady, serverCert: { ...certReady.serverCert, expired: true } }
    const w = await openAddForm()
    await w.find('[data-test="protocol"]').setValue('tcp')
    await tlsBox(w).setValue(true)
    expect(w.find('[data-test="tls-cert-warning"]').text()).toContain('過期')
  })

  it('未勾選 TLS 時不顯示任何憑證提示', async () => {
    gets['/api/tls/status'] = certMissing
    const w = await openAddForm()
    await w.find('[data-test="protocol"]').setValue('tcp')
    expect(w.find('[data-test="tls-cert-warning"]').exists()).toBe(false)
    expect(w.find('[data-test="tls-cert-info"]').exists()).toBe(false)
  })

  it('憑證狀態載入失敗時頁面與表單仍可用，只是不顯示憑證提示', async () => {
    vi.mocked(api.get).mockImplementation(async (u: string) => {
      if (u === '/api/tls/status') throw new Error('boom')
      return gets[u] as never
    })
    const w = await openAddForm()
    expect(w.text()).toContain('net')
    await w.find('[data-test="protocol"]').setValue('tcp')
    await tlsBox(w).setValue(true)
    expect(w.find('[data-test="tls-cert-warning"]').exists()).toBe(false)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/inputs', expect.objectContaining({ tls: true }))
  })
})
