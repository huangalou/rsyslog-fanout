import { test, expect } from '@playwright/test'
import path from 'node:path'

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots')

test.describe.serial('主流程', () => {
  test('登入 → 建立 input/destination/route → 套用 → tail 看到訊息', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('管理密碼').fill(process.env.FANOUT_ADMIN_PASSWORD ?? 'devpass')
    await page.getByRole('button', { name: '登入' }).click()
    await expect(page).toHaveURL('/')

    await page.goto('/inputs')
    await page.getByTestId('add').click()
    await page.getByTestId('name').fill('e2e-in')
    await page.getByTestId('port').fill('5150')
    await page.locator('form').press('Enter')
    await expect(page.getByText('e2e-in')).toBeVisible()

    await page.goto('/forwarding')
    await page.getByTestId('add-dest').click()
    await page.getByTestId('dest-name').fill('e2e-dest')
    await page.getByTestId('dest-host').fill('host.docker.internal')
    await page.getByTestId('dest-port').fill('19999')
    await page.locator('form').press('Enter')
    await page.locator('[data-test^="cell-"] input[type=checkbox]').first().check()
    await page.getByTestId('apply').click()
    await expect(page.getByText('套用成功')).toBeVisible({ timeout: 15000 })

    // 打一筆 log 進 5150，Live Tail 應看到
    // （用 request 觸發輔助端點不可行，改用 exec 打真實的 UDP 封包）
    // Live Tail 的 WS 是「即時推播、無回溯」設計（見 monitor/hub.ts emitTail），沒有連線前送出
    // 的訊息不會補送；先導覽到 /tail 讓 WS 連上，再用 toPass 重送封包直到畫面出現，
    // 避免「WS 尚未 handshake 完成前送出」造成的時間差 flaky。
    await page.goto('/tail')
    await expect(page.locator('[data-test="filter-input"] option', { hasText: 'e2e-in' })).toHaveCount(1)

    const { execSync } = await import('node:child_process')
    await expect(async () => {
      execSync(`printf '<134>e2e tail check' | nc -u -w1 127.0.0.1 5150`)
      await expect(page.getByText('e2e tail check')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000, intervals: [500, 1000, 1000, 2000] })
  })

  test('視覺回歸截圖：Dashboard / Forwarding @ 1440 與 768', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('管理密碼').fill(process.env.FANOUT_ADMIN_PASSWORD ?? 'devpass')
    await page.getByRole('button', { name: '登入' }).click()
    await expect(page).toHaveURL('/')

    for (const viewport of [
      { width: 1440, height: 900, label: '1440' },
      { width: 768, height: 1024, label: '768' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      await page.goto('/')
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `dashboard-${viewport.label}.png`) })

      await page.goto('/forwarding')
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `forwarding-${viewport.label}.png`) })
    }
  })
})
