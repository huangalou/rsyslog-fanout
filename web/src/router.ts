import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn, onLoggedInChange } from './auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/Login.vue') },
    { path: '/', component: () => import('./pages/Dashboard.vue') },
    { path: '/inputs', component: () => import('./pages/Inputs.vue') },
    { path: '/forwarding', component: () => import('./pages/Forwarding.vue') },
    { path: '/tail', component: () => import('./pages/LiveTail.vue') },
    { path: '/sources', component: () => import('./pages/Sources.vue') },
  ],
})

router.beforeEach((to) => {
  if (to.path !== '/login' && !isLoggedIn()) return '/login'
  if (to.path === '/login' && isLoggedIn()) return '/'
})

// 另一分頁登出 → 本分頁若停在需授權頁，立即導回 /login（否則會顯示過期內容直到下次 API 回 401）；
// 另一分頁登入 → 本分頁若停在 /login，直接進入 Dashboard。
onLoggedInChange(() => {
  const path = router.currentRoute.value.path
  if (!isLoggedIn() && path !== '/login') router.push('/login')
  else if (isLoggedIn() && path === '/login') router.push('/')
})
