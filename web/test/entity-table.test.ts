import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EntityTable, { type EntityTableColumn } from '../src/components/EntityTable.vue'

interface Row {
  id: number
  name: string
  status: string
}

const columns: EntityTableColumn[] = [
  { key: 'name', label: '名稱' },
  { key: 'status', label: '狀態' },
]

const rows: Row[] = [
  { id: 1, name: 'a', status: 'ok' },
  { id: 2, name: 'b', status: 'warn' },
]

describe('EntityTable', () => {
  it('依 columns 呈現表頭，依 rows 呈現每列預設值（row[col.key]）', () => {
    const w = mount(EntityTable, { props: { columns, rows } })
    const headers = w.findAll('th').map((th) => th.text())
    expect(headers).toEqual(['名稱', '狀態'])
    expect(w.text()).toContain('a')
    expect(w.text()).toContain('ok')
    expect(w.text()).toContain('b')
    expect(w.text()).toContain('warn')
  })

  it('未提供 actions slot 時不渲染操作欄', () => {
    const w = mount(EntityTable, { props: { columns, rows } })
    expect(w.find('.actions-col').exists()).toBe(false)
  })

  it('cell-<key> slot 可覆寫該欄位呈現，且拿到對應 row', () => {
    const w = mount(EntityTable, {
      props: { columns, rows },
      slots: {
        'cell-status': `<template #cell-status="{ row }"><span class="badge">{{ row.status.toUpperCase() }}</span></template>`,
      },
    })
    expect(w.find('.badge').exists()).toBe(true)
    const badges = w.findAll('.badge').map((b) => b.text())
    expect(badges).toEqual(['OK', 'WARN'])
  })

  it('提供 actions slot 時渲染操作欄並傳入單列 row', () => {
    const w = mount(EntityTable, {
      props: { columns, rows },
      slots: {
        actions: `<template #actions="{ row }"><button class="del">刪除 {{ row.name }}</button></template>`,
      },
    })
    expect(w.findAll('.actions-col').length).toBeGreaterThan(0)
    const buttons = w.findAll('.del').map((b) => b.text())
    expect(buttons).toEqual(['刪除 a', '刪除 b'])
  })
})
