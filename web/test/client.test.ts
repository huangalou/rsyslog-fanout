import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError, setUnauthorizedHandler } from '../src/api/client'
import { i18n } from '../src/i18n'

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

const mockFetchRaw = (status: number, rawBody: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(rawBody, { status })))

afterEach(() => {
  setUnauthorizedHandler(() => {})
})

describe('api client', () => {
  it('成功時回傳 data', async () => {
    mockFetch(200, { success: true, data: [1, 2], error: null })
    expect(await api.get('/api/inputs')).toEqual([1, 2])
  })
  it('已知錯誤碼依當前語系翻譯(zh-TW)', async () => {
    i18n.global.locale.value = 'zh-TW'
    mockFetch(400, {
      success: false, data: null,
      error: { code: 'PORT_OUT_OF_RANGE', message: 'Port 9999 is outside the allowed range (514)', params: { port: 9999, range: '514' } },
    })
    await expect(api.get('/api/inputs')).rejects.toMatchObject({
      message: '埠號 9999 不在允許範圍（514）',
      code: 'PORT_OUT_OF_RANGE',
      status: 400,
    })
  })
  it('已知錯誤碼依當前語系翻譯(en)', async () => {
    i18n.global.locale.value = 'en'
    mockFetch(401, { success: false, data: null, error: { code: 'PASSWORD_INCORRECT', message: 'Incorrect password' } })
    await expect(api.post('/api/auth/login', { password: 'x' })).rejects.toMatchObject({ message: 'Incorrect password' })
    i18n.global.locale.value = 'zh-TW'
  })
  it('VALIDATION 錯誤把 server 訊息插進翻譯', async () => {
    mockFetch(400, { success: false, data: null, error: { code: 'VALIDATION', message: 'port must be an integer' } })
    await expect(api.post('/api/inputs', {})).rejects.toMatchObject({
      message: '輸入資料驗證失敗：port must be an integer',
    })
  })
  it('zod 自訂格式錯誤碼(HOST_FORMAT)依語系翻譯', async () => {
    mockFetch(400, { success: false, data: null, error: { code: 'HOST_FORMAT', message: 'Host may only contain letters, digits, dots, and hyphens' } })
    await expect(api.post('/api/destinations', {})).rejects.toMatchObject({
      message: '主機名稱僅允許字母、數字、點與連字號，或 IPv6 位址',
    })
  })
  it('未知錯誤碼 fallback 到 server 英文 message', async () => {
    mockFetch(400, { success: false, data: null, error: { code: 'SOME_FUTURE_CODE', message: 'something new happened' } })
    await expect(api.get('/api/inputs')).rejects.toMatchObject({ message: 'something new happened' })
  })
  it('舊式字串 error(防禦性)直接顯示', async () => {
    mockFetch(400, { success: false, data: null, error: '埠號不在允許範圍' })
    await expect(api.get('/api/inputs')).rejects.toMatchObject({ message: '埠號不在允許範圍', status: 400 })
  })
  it('401 時導向 /login', async () => {
    mockFetch(401, { success: false, data: null, error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } })
    const spy = vi.spyOn(window.history, 'pushState')
    await expect(api.get('/api/inputs')).rejects.toBeInstanceOf(ApiError)
    // router 注入見實作：client 觸發全域 callback
  })
  it('非 JSON 回應（如 502 HTML）時丟 ApiError 而非未捕捉的 SyntaxError', async () => {
    mockFetchRaw(502, '<html>bad gateway</html>')
    const err = await api.get('/api/inputs').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(502)
  })
  it('401 + 非 JSON body 時仍會觸發 onUnauthorized handler', async () => {
    mockFetchRaw(401, '<html>unauthorized</html>')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await expect(api.get('/api/inputs')).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
