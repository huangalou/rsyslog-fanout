import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))
import Forwarding from '../src/pages/Forwarding.vue'
import { api, ApiError } from '../src/api/client'

const mountPage = async () => {
  const w = mount(Forwarding, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  gets['/api/routes'] = []
  vi.mocked(api.get).mockClear()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.post).mockResolvedValue({ applied: true })
  vi.mocked(api.put).mockReset()
  vi.mocked(api.del).mockReset()
})

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

describe('Apply 成功回饋', () => {
  it('套用成功後顯示 apply-success 狀態文字', async () => {
    const w = mount(Forwarding, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.find('[data-test="apply-success"]').exists()).toBe(false)
    await w.find('[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="apply-success"]').exists()).toBe(true)
    expect(w.find('[data-test="apply-success"]').attributes('role')).toBe('status')
  })
})

describe('Destinations CRUD', () => {
  it('新增目的地：送出表單呼叫 POST /api/destinations 並重新載入清單', async () => {
    const w = await mountPage()
    await w.find('[data-test="add-dest"]').trigger('click')
    await w.find('[data-test="dest-name"]').setValue('siem')
    await w.find('[data-test="dest-protocol"]').setValue('tcp')
    await w.find('[data-test="dest-host"]').setValue('10.9.9.9')
    await w.find('[data-test="dest-port"]').setValue('6514')
    await w.find('[data-test="dest-headerMode-standard"]').setValue(true)
    await w.find('form.entity-form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/destinations', {
      name: 'siem', protocol: 'tcp', host: '10.9.9.9', port: 6514, headerMode: 'standard', enabled: true,
    })
    expect(w.find('form.entity-form').exists()).toBe(false)
    expect(vi.mocked(api.get).mock.calls.filter(([u]) => u === '/api/destinations')).toHaveLength(2)
  })

  it('編輯目的地：帶入現值，送出呼叫 PUT /api/destinations/:id', async () => {
    const w = await mountPage()
    await w.find('[data-test="dest-edit"]').trigger('click')
    expect((w.find('[data-test="dest-name"]').element as HTMLInputElement).value).toBe('arcsight')
    expect((w.find('[data-test="dest-host"]').element as HTMLInputElement).value).toBe('10.0.0.5')
    await w.find('[data-test="dest-name"]').setValue('arcsight-2')
    await w.find('form.entity-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/api/destinations/1', expect.objectContaining({ name: 'arcsight-2', host: '10.0.0.5' }))
  })

  it('取消表單後關閉且下次開新增時欄位已重置', async () => {
    const w = await mountPage()
    await w.find('[data-test="dest-edit"]').trigger('click')
    await w.find('form.entity-form button[type="button"]').trigger('click')
    expect(w.find('form.entity-form').exists()).toBe(false)
    await w.find('[data-test="add-dest"]').trigger('click')
    expect((w.find('[data-test="dest-name"]').element as HTMLInputElement).value).toBe('')
  })

  it('新增失敗時在表單內以 role=alert 顯示錯誤，表單保持開啟', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError('名稱已被使用', 400))
    const w = await mountPage()
    await w.find('[data-test="add-dest"]').trigger('click')
    await w.find('[data-test="dest-name"]').setValue('arcsight')
    await w.find('[data-test="dest-host"]').setValue('h')
    await w.find('form.entity-form').trigger('submit')
    await flushPromises()
    expect(w.find('form.entity-form [role="alert"]').text()).toBe('名稱已被使用')
  })

  it('刪除目的地：confirm 確認後呼叫 DELETE；取消則不呼叫', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = await mountPage()
    await w.find('[data-test="dest-delete"]').trigger('click')
    await flushPromises()
    expect(api.del).not.toHaveBeenCalled()
    confirmSpy.mockReturnValue(true)
    await w.find('[data-test="dest-delete"]').trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/api/destinations/1')
  })

  it('刪除失敗時在清單上方顯示錯誤', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.del).mockRejectedValueOnce(new Error('刪除失敗'))
    const w = await mountPage()
    await w.find('[data-test="dest-delete"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toBe('刪除失敗')
  })

  it('清單顯示 host:port 與啟用狀態', async () => {
    const w = await mountPage()
    const row = w.find('.entity-table tbody tr')
    expect(row.text()).toContain('10.0.0.5:514')
    expect(row.text()).toContain('raw')
    expect(row.text()).toContain('是')
  })
})

describe('Routes：取消勾選與過濾條件', () => {
  const existingRoute = { id: 7, inputId: 1, destinationId: 1, sourceFilter: null, facilities: null, maxSeverity: null }

  it('取消勾選既有 route 呼叫 DELETE /api/routes/:id', async () => {
    gets['/api/routes'] = [existingRoute]
    const w = await mountPage()
    const box = w.find('[data-test="cell-1-1"] input[type=checkbox]')
    expect((box.element as HTMLInputElement).checked).toBe(true)
    await box.setValue(false)
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/api/routes/7')
  })

  it('建立 route 失敗時顯示錯誤並重新載入 routes', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('此接收與目的地之間已存在路由'))
    const w = await mountPage()
    await w.find('[data-test="cell-1-1"] input[type=checkbox]').setValue(true)
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toBe('此接收與目的地之間已存在路由')
  })

  it('齒輪開啟過濾表單；儲存時先刪舊 route 再以新條件建立', async () => {
    gets['/api/routes'] = [{ ...existingRoute, sourceFilter: '10.0.0.0/8' }]
    const w = await mountPage()
    expect(w.find('.filter-form').exists()).toBe(false)
    await w.find('[data-test="gear-1-1"]').trigger('click')
    expect((w.find('[data-test="filter-source"]').element as HTMLInputElement).value).toBe('10.0.0.0/8')
    await w.find('[data-test="filter-severity"]').setValue(4)
    await w.find('.filter-form').trigger('submit')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/api/routes/7')
    expect(api.post).toHaveBeenCalledWith('/api/routes', { inputId: 1, destinationId: 1, sourceFilter: '10.0.0.0/8', facilities: null, maxSeverity: 4 })
    expect(w.find('.filter-form').exists()).toBe(false)
  })

  it('尚無 route 時以過濾條件直接建立，不呼叫 DELETE', async () => {
    const w = await mountPage()
    await w.find('[data-test="gear-1-1"]').trigger('click')
    await w.find('[data-test="filter-source"]').setValue('10.1.2.3')
    await w.find('.filter-form').trigger('submit')
    await flushPromises()
    expect(api.del).not.toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith('/api/routes', expect.objectContaining({ sourceFilter: '10.1.2.3' }))
  })

  it('舊 route 已刪但新 route 建立失敗：提示原過濾條件已移除並重新載入', async () => {
    gets['/api/routes'] = [existingRoute]
    vi.mocked(api.post).mockRejectedValueOnce(new Error('僅接受完整 IP 或 /8、/16、/24 CIDR'))
    const w = await mountPage()
    await w.find('[data-test="gear-1-1"]').trigger('click')
    await w.find('[data-test="filter-source"]').setValue('bad')
    await w.find('.filter-form').trigger('submit')
    await flushPromises()
    const alert = w.find('[role="alert"]')
    expect(alert.text()).toContain('原有路由已被移除')
    expect(alert.text()).toContain('/24 CIDR')
    expect(vi.mocked(api.get).mock.calls.filter(([u]) => u === '/api/routes')).toHaveLength(2)
  })

  it('取消過濾表單即關閉，不呼叫 API', async () => {
    const w = await mountPage()
    await w.find('[data-test="gear-1-1"]').trigger('click')
    await w.find('.filter-form button[type="button"]').trigger('click')
    expect(w.find('.filter-form').exists()).toBe(false)
    expect(api.post).not.toHaveBeenCalled()
  })
})

describe('Apply 失敗回饋', () => {
  it('server 回傳 applied=false 時不顯示成功訊息', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ applied: false, stage: 'validate', error: 'syntax error' })
    const w = await mountPage()
    await w.find('[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="apply-success"]').exists()).toBe(false)
  })

  it('apply 請求失敗時顯示錯誤內容並解除按鈕 disabled', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('rsyslogd: restart failed'))
    const w = await mountPage()
    await w.find('[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="apply-error"]').text()).toBe('rsyslogd: restart failed')
    expect(w.find('[data-test="apply"]').attributes('disabled')).toBeUndefined()
  })

  it('dirty 狀態顯示「尚未套用變更」徽章', async () => {
    const w = await mountPage()
    expect(w.find('[data-test="dirty-badge"]').exists()).toBe(true)
  })
})
