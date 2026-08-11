import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useSession = defineStore('session', {
  state: () => ({ loggedIn: false }),
  actions: {
    async login(password: string) {
      await api.post('/api/auth/login', { password })
      this.loggedIn = true
    },
    async logout() {
      await api.post('/api/auth/logout')
      this.loggedIn = false
    },
  },
})
