import { createI18n } from 'vue-i18n'
import zhTW from './zh-TW'
import en from './en'

export type Locale = 'zh-TW' | 'en'
export const LOCALE_STORAGE_KEY = 'fanout-locale'
const SUPPORTED: Locale[] = ['zh-TW', 'en']

// 語言決定順序:使用者手動選擇(localStorage)> 瀏覽器語言(zh* → 繁中,其他 → 英文)
export function detectLocale(saved: string | null, navigatorLanguage: string): Locale {
  if (saved && SUPPORTED.includes(saved as Locale)) return saved as Locale
  return navigatorLanguage.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCALE_STORAGE_KEY),
    typeof navigator === 'undefined' ? 'en' : navigator.language,
  ),
  fallbackLocale: 'en',
  messages: { 'zh-TW': zhTW, en },
})

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}
