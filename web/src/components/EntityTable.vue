<script setup lang="ts" generic="T">
// 通用清單表格：Task 14（Destinations/Routes）、Task 15（Sources）重用。
// columns 決定表頭與欄位順序；rows 為呼叫端自訂形狀的資料列（不限定 Record 索引簽章，
// 讓一般 domain interface 如 Input/Destination 可直接當作型別參數，不需雙重轉型）。
// 呼叫端可用具名 slot `cell-<key>` 覆寫該欄位的呈現方式（例如格式化、狀態徽章），
// 未覆寫時預設用 row[col.key] 呈現。
// `actions` slot 傳入單列 row（型別 T），供呼叫端放編輯/刪除按鈕。
export interface EntityTableColumn {
  key: string
  label: string
}

defineProps<{
  columns: EntityTableColumn[]
  rows: T[]
}>()

defineSlots<
  Record<`cell-${string}`, (props: { row: T }) => unknown> & {
    actions?: (props: { row: T }) => unknown
  }
>()

// 內部索引存取集中在這裡：rows 的具體形狀由呼叫端的 T 決定，元件本身無法在編譯期
// 保證每個 column.key 都存在於 T 上，因此只在此處做一次受控的型別放寬，
// 避免每個呼叫端都要各自寫 `row as unknown as X`。
function cellValue(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

function rowKey(row: T, fallbackIndex: number): string | number {
  const id = (row as Record<string, unknown>).id
  return typeof id === 'string' || typeof id === 'number' ? id : fallbackIndex
}
</script>

<template>
  <table class="entity-table">
    <thead>
      <tr>
        <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
        <th v-if="$slots.actions" class="actions-col">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, i) in rows" :key="rowKey(row, i)">
        <td v-for="col in columns" :key="col.key">
          <slot :name="`cell-${col.key}`" :row="row">{{ cellValue(row, col.key) }}</slot>
        </td>
        <td v-if="$slots.actions" class="actions-col">
          <slot name="actions" :row="row" />
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.entity-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-ui);
  font-size: 0.9rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.entity-table th,
.entity-table td {
  text-align: left;
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-border);
}

.entity-table th {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
  background: var(--color-surface-raised);
}

.entity-table tbody tr:last-child td {
  border-bottom: none;
}

.entity-table tbody tr:hover {
  background: var(--color-surface-raised);
}

.actions-col {
  white-space: nowrap;
  width: 1%;
}
</style>
