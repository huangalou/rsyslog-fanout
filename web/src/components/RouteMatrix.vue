<script setup lang="ts">
// Routes 矩陣：列 = input、欄 = destination 的核取表格。
// 勾選 = 建立無過濾條件的 route；取消勾選 = 刪除該 route。
// 每格旁的「⚙」開啟 RouteFilterForm 設定該 route 的 sourceFilter/facilities/maxSeverity；
// 已設定過濾條件的格子額外顯示濾鏡圖示。
// 本元件不直接呼叫 API：所有變更以 emit 交給 Forwarding.vue，維持單一資料流向與可測試性。
interface Input {
  id: number
  name: string
}
interface Destination {
  id: number
  name: string
}
interface RouteRule {
  id: number
  inputId: number
  destinationId: number
  sourceFilter: string | null
  facilities: number[] | null
  maxSeverity: number | null
}

const props = defineProps<{
  inputs: Input[]
  destinations: Destination[]
  routes: RouteRule[]
}>()

const emit = defineEmits<{
  toggle: [inputId: number, destinationId: number, checked: boolean]
  'edit-filter': [inputId: number, destinationId: number]
}>()

function findRoute(inputId: number, destinationId: number): RouteRule | undefined {
  return props.routes.find((r) => r.inputId === inputId && r.destinationId === destinationId)
}

function hasFilter(route: RouteRule | undefined): boolean {
  if (!route) return false
  return route.sourceFilter !== null || route.facilities !== null || route.maxSeverity !== null
}

function onToggle(inputId: number, destinationId: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  emit('toggle', inputId, destinationId, checked)
}
</script>

<template>
  <table class="route-matrix">
    <thead>
      <tr>
        <th class="corner"></th>
        <th v-for="dest in destinations" :key="dest.id">{{ dest.name }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="input in inputs" :key="input.id">
        <th scope="row">{{ input.name }}</th>
        <td v-for="dest in destinations" :key="dest.id" :data-test="`cell-${input.id}-${dest.id}`" class="matrix-cell">
          <input
            type="checkbox"
            :checked="!!findRoute(input.id, dest.id)"
            @change="onToggle(input.id, dest.id, $event)"
          />
          <button
            type="button"
            class="gear"
            :data-test="`gear-${input.id}-${dest.id}`"
            title="設定過濾條件"
            @click="emit('edit-filter', input.id, dest.id)"
          >
            ⚙
          </button>
          <span v-if="hasFilter(findRoute(input.id, dest.id))" class="filter-icon" title="已設定過濾條件">🔍</span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.route-matrix {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-ui);
  font-size: 0.85rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.route-matrix th,
.route-matrix td {
  padding: var(--space-sm);
  border-bottom: 1px solid var(--color-border);
  text-align: center;
}

.route-matrix thead th {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
}

.route-matrix tbody th {
  text-align: left;
  font-weight: normal;
  color: var(--color-text);
  background: var(--color-surface-raised);
}

.corner {
  background: var(--color-surface-raised);
}

.matrix-cell {
  display: table-cell;
  vertical-align: middle;
  white-space: nowrap;
}

.gear {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0 var(--space-xs);
}

.gear:hover {
  color: var(--color-accent);
}

.filter-icon {
  font-size: 0.75rem;
}
</style>
