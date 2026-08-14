import { defineStore } from 'pinia'
import { api } from '../api/client'
import { isLoggedIn, markLoggedIn, clearLoggedIn } from '../auth'

export const useSession = defineStore('session', {
  state: () => ({ loggedIn: isLoggedIn() }),
  actions: {
    async login(password: string) {
      await api.post('/api/auth/login', { password })
      markLoggedIn()
      this.loggedIn = true
    },
    async logout() {
      await api.post('/api/auth/logout')
      clearLoggedIn()
      this.loggedIn = false
    },
  },
})
