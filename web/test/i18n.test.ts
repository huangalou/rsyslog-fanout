import { describe, it, expect, beforeEach } from 'vitest'
import { detectLocale, setLocale, i18n, LOCALE_STORAGE_KEY } from '../src/i18n'
import zhTW from '../src/i18n/zh-TW'
import en from '../src/i18n/en'

describe('detectLocale', () => {
  it('localStorage 已存的選擇優先於瀏覽器語言', () => {
    expect(detectLocale('en', 'zh-TW')).toBe('en')
    expect(detectLocale('zh-TW', 'en-US')).toBe('zh-TW')
  })
  it('無已存選擇時,zh 開頭的瀏覽器語言 → zh-TW', () => {
    expect(detectLocale(null, 'zh-TW')).toBe('zh-TW')
    expect(detectLocale(null, 'zh')).toBe('zh-TW')
    expect(detectLocale(null, 'zh-CN')).toBe('zh-TW')
  })
  it('無已存選擇時,非 zh 瀏覽器語言 → en', () => {
    expect(detectLocale(null, 'en-US')).toBe('en')
    expect(detectLocale(null, 'ja')).toBe('en')
  })
  it('已存值非法時忽略,回落瀏覽器判斷', () => {
    expect(detectLocale('fr', 'zh-TW')).toBe('zh-TW')
  })
})

describe('setLocale', () => {
  beforeEach(() => localStorage.clear())
  it('切換 i18n 語系並持久化到 localStorage', () => {
    setLocale('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    setLocale('zh-TW')
    expect(i18n.global.locale.value).toBe('zh-TW')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-TW')
  })
})

describe('訊息檔完整性', () => {
  const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
    )
  it('zh-TW 與 en 的 key 集合完全一致', () => {
    expect(flatten(zhTW).sort()).toEqual(flatten(en).sort())
  })
})
