import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RouteFilterForm, { type RouteFilterValue } from '../src/components/RouteFilterForm.vue'

const empty: RouteFilterValue = { sourceFilter: null, facilities: null, maxSeverity: null }
const mountForm = (modelValue: RouteFilterValue = empty) => mount(RouteFilterForm, { props: { modelValue } })
const lastSave = (w: ReturnType<typeof mountForm>): RouteFilterValue => w.emitted('save')!.at(-1)![0] as RouteFilterValue

describe('RouteFilterForm', () => {
  it('全部留空送出時三個欄位皆為 null', async () => {
    const w = mountForm()
    await w.find('form').trigger('submit')
    expect(lastSave(w)).toEqual(empty)
  })

  it('sourceFilter 去除前後空白；純空白視為 null', async () => {
    const w = mountForm()
    await w.find('[data-test="filter-source"]').setValue('  10.1.0.0/16  ')
    await w.find('form').trigger('submit')
    expect(lastSave(w).sourceFilter).toBe('10.1.0.0/16')
    await w.find('[data-test="filter-source"]').setValue('   ')
    await w.find('form').trigger('submit')
    expect(lastSave(w).sourceFilter).toBeNull()
  })

  it('facilities 多選以數字陣列送出', async () => {
    const w = mountForm()
    await w.find('[data-test="filter-facilities"]').setValue(['16', '17'])
    await w.find('form').trigger('submit')
    expect(lastSave(w).facilities).toEqual([16, 17])
  })

  it('maxSeverity 選項以數字送出', async () => {
    const w = mountForm()
    await w.find('[data-test="filter-severity"]').setValue(3)
    await w.find('form').trigger('submit')
    expect(lastSave(w).maxSeverity).toBe(3)
  })

  it('既有過濾條件帶入初始欄位值', () => {
    const w = mountForm({ sourceFilter: '10.0.0.1', facilities: [4], maxSeverity: 5 })
    expect((w.find('[data-test="filter-source"]').element as HTMLInputElement).value).toBe('10.0.0.1')
    const selected = [...(w.find('[data-test="filter-facilities"]').element as HTMLSelectElement).selectedOptions].map((o) => o.text)
    expect(selected).toEqual(['4 auth'])
    expect((w.find('[data-test="filter-severity"]').element as HTMLSelectElement).value).toBe('5')
  })

  it('設施與嚴重度選單列出完整 syslog 名稱', () => {
    const w = mountForm()
    expect(w.findAll('[data-test="filter-facilities"] option')).toHaveLength(24)
    expect(w.findAll('[data-test="filter-severity"] option')).toHaveLength(9)  // 「不限制」+ 8 級
    expect(w.text()).toContain('local7')
    expect(w.text()).toContain('emerg(0)')
  })

  it('取消按鈕 emit cancel 且不 emit save', async () => {
    const w = mountForm()
    await w.find('button[type="button"]').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('save')).toBeUndefined()
  })
})
