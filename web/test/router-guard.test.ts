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
