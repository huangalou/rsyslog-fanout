<script setup lang="ts">
// 來源狀態頁：列出 stats store 的 sources 快照（Task 15）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useStats } from '../stores/stats'
import EntityTable, { type EntityTableColumn } from '../components/EntityTable.vue'

const stats = useStats()

const columns: EntityTableColumn[] = [
  { key: 'ip', label: 'IP' },
  { key: 'lastSeen', label: '最後收到' },
  { key: 'stale', label: '狀態' },
]

const sortedSources = computed(() => [...(stats.snapshot?.sources ?? [])].sort((a, b) => b.lastSeen - a.lastSeen))

// now 每秒更新一次，讓「最後收到」的相對時間持續走動而非停在掛載當下。
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

function relativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((now.value - ts) / 1000))
  if (diffSec < 60) return `${diffSec} 秒前`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分鐘前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小時前`
  return `${Math.floor(diffHour / 24)} 天前`
}

onMounted(() => {
  stats.start()
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  stats.stop()
  if (timer) clearInterval(timer)
  timer = null
})
</script>

<template>
  <section class="page">
    <h1>來源狀態</h1>

    <EntityTable :columns="columns" :rows="sortedSources">
      <template #cell-lastSeen="{ row }">{{ relativeTime(row.lastSeen) }}</template>
      <template #cell-stale="{ row }">
        <span v-if="row.stale" class="badge-stale" data-test="stale-badge">疑似斷訊</span>
        <span v-else class="badge-ok">正常</span>
      </template>
    </EntityTable>

    <p v-if="sortedSources.length === 0" class="empty">尚無來源資料</p>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.badge-stale {
  font-family: var(--font-ui);
  font-size: 0.75rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--color-danger);
  color: var(--color-bg);
}

.badge-ok {
  font-family: var(--font-ui);
  font-size: 0.75rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
}

.empty {
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: 0.875rem;
  margin: 0;
}
</style>
