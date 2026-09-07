import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': { target: 'http://localhost:8080', ws: true } } },
  test: {
    environment: 'jsdom', setupFiles: ['./test/setup.ts'],
    // 門檻為防倒退底線：2026-09-07 實測水位 lines 96 / statements 95 / functions 90 / branches 87
    // （分母含 router 所觸及的全部頁面），一律掛在原定目標 80，留餘裕給新頁面。
    coverage: { provider: 'v8', thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 } },
  },
})
