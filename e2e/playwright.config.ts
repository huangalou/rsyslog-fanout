import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:8080', testIdAttribute: 'data-test' },
  retries: 1,
})
