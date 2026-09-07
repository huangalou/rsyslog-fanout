import { describe, it, expect, beforeEach } from 'vitest'
import { router } from '../src/router'
import { isLoggedIn, markLoggedIn, clearLoggedIn } from '../src/auth'

describe('router guard：未登入不進入需授權頁（不打 API 吃 401）', () => {
  beforeEach(async () => {
    clearLoggedIn()
    await router.replace('/login')   // 每次從已知位置出發
    await router.isReady()
  })

  it('未登入訪 / → 導向 /login', async () => {
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('未登入訪 /forwarding → 導向 /login', async () => {
    await router.push('/forwarding')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('登入旗標存在時可進入 /', async () => {
    markLoggedIn()
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('已登入訪 /login → 導回 /', async () => {
    markLoggedIn()
    await router.push('/')           // 先處於需授權頁
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('旗標以 localStorage 持久化（重新整理後仍有效）', () => {
    markLoggedIn()
    expect(isLoggedIn()).toBe(true)
    clearLoggedIn()
    expect(isLoggedIn()).toBe(false)
  })
})

// 跨分頁同步：登入旗標存在 localStorage，另一分頁登出/登入時本分頁會收到 storage 事件。
// 未同步時本分頁停在需授權頁顯示過期內容（直到下一次 API 回 401），或停在 /login 明明已登入。
describe('router：跨分頁登入旗標同步', () => {
  const fire = (newValue: string | null) => {
    if (newValue === null) localStorage.removeItem('fanout_logged_in')
    else localStorage.setItem('fanout_logged_in', newValue)
    window.dispatchEvent(new StorageEvent('storage', { key: 'fanout_logged_in', newValue, storageArea: localStorage }))
  }
  const settled = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(async () => {
    clearLoggedIn()
    await router.replace('/login')
    await router.isReady()
  })

  it('另一分頁登出（旗標被清）→ 本分頁自需授權頁導向 /login', async () => {
    markLoggedIn()
    await router.push('/sources')
    expect(router.currentRoute.value.path).toBe('/sources')
    fire(null)
    await settled()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('另一分頁登入（旗標被設）→ 本分頁自 /login 導向 /', async () => {
    fire('1')
    await settled()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('另一分頁 localStorage.clear()（key=null）視同旗標被清', async () => {
    markLoggedIn()
    await router.push('/')
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null, storageArea: localStorage }))
    await settled()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('無關 key 的 storage 事件不觸發導向', async () => {
    markLoggedIn()
    await router.push('/sources')
    window.dispatchEvent(new StorageEvent('storage', { key: 'fanout-locale', newValue: 'en', storageArea: localStorage }))
    await settled()
    expect(router.currentRoute.value.path).toBe('/sources')
  })
})
