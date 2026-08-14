import { test, expect } from '@playwright/test'

// 英文語系 smoke:瀏覽器語言為 en 時自動顯示英文,切換器可切回繁中並持久化。
test.use({ locale: 'en-US' })

test('英文瀏覽器自動顯示英文,切換繁中後重新整理仍為繁中', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByPlaceholder('Admin password')).toBeVisible()

  await page.getByTestId('lang-zh-TW').click()
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible()
  // 不需手動清 localStorage:Playwright 每個 test 有獨立 browser context,偏好不會外洩到其他測試。
})
