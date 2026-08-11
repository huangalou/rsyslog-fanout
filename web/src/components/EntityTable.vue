<script setup lang="ts">
// 通用清單表格：Task 14（Destinations/Routes）、Task 15（Sources）重用。
// columns 決定表頭與欄位順序；rows 為任意形狀的資料列，透過 row[col.key] 取值，
// 呼叫端可用具名 slot `cell-<key>` 覆寫該欄位的呈現方式（例如格式化、狀態徽章）。
// `actions` slot 傳入單列 row，供呼叫端放編輯/刪除按鈕。
export interface EntityTableColumn {
  key: string
  label: string
}

defineProps<{
  columns: EntityTableColumn[]
  rows: Record<string, unknown>[]
}>()
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
      <tr v-for="(row, i) in rows" :key="(row.id as string | number | undefined) ?? i">
        <td v-for="col in columns" :key="col.key">
          <slot :name="`cell-${col.key}`" :row="row">{{ row[col.key] }}</slot>
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
