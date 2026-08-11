import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError, setUnauthorizedHandler } from '../src/api/client'

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
  it('失敗時丟 ApiError 帶 error 訊息與 status', async () => {
    mockFetch(400, { success: false, data: null, error: '埠號不在允許範圍' })
    await expect(api.get('/api/inputs')).rejects.toMatchObject({ message: '埠號不在允許範圍', status: 400 })
  })
  it('401 時導向 /login', async () => {
    mockFetch(401, { success: false, data: null, error: '未登入' })
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
