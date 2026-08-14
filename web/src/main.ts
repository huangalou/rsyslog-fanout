import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/tokens.css'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { setUnauthorizedHandler } from './api/client'

setUnauthorizedHandler(() => router.push('/login'))

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')
