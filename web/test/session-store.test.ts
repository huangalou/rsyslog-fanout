import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(async () => ({})), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
import { useSession } from '../src/stores/session'
import { api } from '../src/api/client'
import { isLoggedIn, markLoggedIn, clearLoggedIn } from '../src/auth'

beforeEach(() => {
  setActivePinia(createPinia())
  clearLoggedIn()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.post).mockResolvedValue({})
})

describe('session store', () => {
  it('初始 loggedIn 反映 localStorage 旗標', () => {
    markLoggedIn()
    expect(useSession().loggedIn).toBe(true)
  })

  it('login 成功後標記旗標並設 loggedIn=true', async () => {
    const s = useSession()
    expect(s.loggedIn).toBe(false)
    await s.login('pw')
    expect(api.post).toHaveBeenCalledWith('/api/auth/login', { password: 'pw' })
    expect(isLoggedIn()).toBe(true)
    expect(s.loggedIn).toBe(true)
  })

  it('login 失敗時不標記旗標，錯誤向上拋出', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('密碼錯誤'))
    const s = useSession()
    await expect(s.login('bad')).rejects.toThrow('密碼錯誤')
    expect(isLoggedIn()).toBe(false)
    expect(s.loggedIn).toBe(false)
  })

  it('logout 呼叫 POST /api/auth/logout、清旗標並設 loggedIn=false', async () => {
    markLoggedIn()
    const s = useSession()
    await s.logout()
    expect(api.post).toHaveBeenCalledWith('/api/auth/logout')
    expect(isLoggedIn()).toBe(false)
    expect(s.loggedIn).toBe(false)
  })
})
