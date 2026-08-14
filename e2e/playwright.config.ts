import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // locale 固定 zh-TW:主流程測試以中文文字斷言;英文另有切換語言的 smoke test。
  use: { baseURL: 'http://localhost:8080', testIdAttribute: 'data-test', locale: 'zh-TW' },
  retries: 1,
})
