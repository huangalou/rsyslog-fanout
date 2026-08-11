import { createRouter, createWebHistory } from 'vue-router'

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
