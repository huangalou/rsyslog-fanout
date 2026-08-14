import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/tokens.css'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { setUnauthorizedHandler } from './api/client'
import { clearLoggedIn } from './auth'

setUnauthorizedHandler(() => {
  clearLoggedIn()                    // 旗標過期：清掉讓 guard 之後直接擋在 /login
  router.push('/login')
})

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')
