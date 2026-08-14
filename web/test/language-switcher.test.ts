import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LanguageSwitcher from '../src/components/LanguageSwitcher.vue'
import { i18n, LOCALE_STORAGE_KEY } from '../src/i18n'

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    i18n.global.locale.value = 'zh-TW'
  })

  it('點 EN 切換語系並持久化', async () => {
    const w = mount(LanguageSwitcher)
    await w.find('[data-test="lang-en"]').trigger('click')
    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })

  it('目前語系的按鈕標示 aria-pressed', () => {
    const w = mount(LanguageSwitcher)
    expect(w.find('[data-test="lang-zh-TW"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-test="lang-en"]').attributes('aria-pressed')).toBe('false')
  })
})
