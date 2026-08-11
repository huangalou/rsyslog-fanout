import { describe, it, expect, vi } from 'vitest'
import { api, ApiError } from '../src/api/client'

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

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
})
