import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
vi.mock('../src/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(async () => ({})), put: vi.fn(), del: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))
import Login from '../src/pages/Login.vue'
import { api } from '../src/api/client'
import { isLoggedIn, clearLoggedIn } from '../src/auth'

const Blank = { template: '<div />' }
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: Blank }, { path: '/login', component: Blank }],
  })
}

async function mountLogin() {
  const router = makeRouter()
  await router.push('/login')
  await router.isReady()
  const w = mount(Login, { global: { plugins: [createPinia(), router] } })
  return { w, router }
}

beforeEach(() => {
  clearLoggedIn()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.post).mockResolvedValue({})
})

describe('Login page', () => {
  it('送出密碼呼叫 POST /api/auth/login，成功後標記旗標並導向 /', async () => {
    const { w, router } = await mountLogin()
    await w.find('input[type=password]').setValue('secret-pw')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/api/auth/login', { password: 'secret-pw' })
    expect(isLoggedIn()).toBe(true)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('登入失敗時以 role=alert 顯示錯誤訊息，不標記旗標、停留在 /login', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('密碼錯誤'))
    const { w, router } = await mountLogin()
    await w.find('input[type=password]').setValue('wrong')
    await w.find('form').trigger('submit')
    await flushPromises()
    const alert = w.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe('密碼錯誤')
    expect(isLoggedIn()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('重送前清除上一次錯誤訊息', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('密碼錯誤'))
    const { w } = await mountLogin()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('表單含語言切換器，可在登入前切換語系', async () => {
    const { w } = await mountLogin()
    expect(w.find('[data-test="lang-en"]').exists()).toBe(true)
  })
})
