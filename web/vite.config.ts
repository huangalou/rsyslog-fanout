import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': { target: 'http://localhost:8080', ws: true } } },
  test: {
    environment: 'jsdom', setupFiles: ['./test/setup.ts'],
    // 門檻為 ratchet 式防倒退底線（以 2026-08-15 實測水位為準，分母含 router
    // 所觸及的全部頁面），目標逐步升到 80
    coverage: { provider: 'v8', thresholds: { lines: 60, statements: 58, functions: 49, branches: 39 } },
  },
})
