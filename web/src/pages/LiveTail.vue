<script setup lang="ts">
// Live Tail：訂閱 WS 的 tail 事件並即時捲動顯示（Task 15）。
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { api } from '../api/client'
import { connectWs } from '../api/ws'
import { useTail, type TailMsg } from '../stores/tail'

interface Input {
  id: number
  name: string
}

const SEVERITY_NAMES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']

function severityClass(sev: number): string {
  if (sev <= 3) return 'sev-danger'
  if (sev <= 4) return 'sev-warn'
  return 'sev-ok'
}

function severityLabel(sev: number): string {
  return SEVERITY_NAMES[sev] ?? String(sev)
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-TW', { hour12: false })
}

const tail = useTail()
const inputs = ref<Input[]>([])
const scrollEl = ref<HTMLElement | null>(null)
let stopWs: (() => void) | null = null
// onMounted 內有一段 await（GET /api/inputs）；若使用者在該 await 完成前就切走頁面
// （onUnmounted 先跑），cancelled 讓 resolve 之後續行的程式碼知道自己已被取消，
// 不再呼叫 connectWs（否則會建立一個沒有 stopWs 參照、無人能取消的 WS 連線洩漏，
// 與 Task 12 修的 stats store _cancelled 問題相同）。
let cancelled = false

function inputName(id: number): string {
  return inputs.value.find((i) => i.id === id)?.name ?? `#${id}`
}

function togglePaused() {
  tail.setPaused(!tail.paused)
}

async function scrollToBottom() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => tail.visible.length,
  () => {
    if (!tail.paused) scrollToBottom()
  },
)

onMounted(async () => {
  try {
    inputs.value = await api.get<Input[]>('/api/inputs')
  } catch {
    inputs.value = []
  }
  if (cancelled) return
  stopWs = connectWs({ onTail: (m) => tail.push(m as TailMsg) })
})

onUnmounted(() => {
  cancelled = true
  stopWs?.()
  stopWs = null
})

const filterValue = computed({
  get: () => (tail.filterInput === null ? '' : String(tail.filterInput)),
  set: (v: string) => {
    tail.filterInput = v === '' ? null : Number(v)
  },
})
</script>

<template>
  <section class="page">
    <h1>Live Tail</h1>

    <div class="toolbar">
      <label class="filter-label">
        接收來源過濾
        <select data-test="filter-input" v-model="filterValue">
          <option value="">（全部）</option>
          <option v-for="i in inputs" :key="i.id" :value="String(i.id)">{{ i.name }}</option>
        </select>
      </label>
      <button type="button" data-test="pause-toggle" @click="togglePaused">
        {{ tail.paused ? '繼續' : '暫停' }}
      </button>
    </div>

    <div ref="scrollEl" class="tail-scroll" data-test="tail-scroll">
      <p v-if="tail.visible.length === 0" class="empty">尚無訊息</p>
      <div v-for="(line, i) in tail.visible" :key="i" class="tail-line">
        <span class="ts">{{ formatTime(line.ts) }}</span>
        <span class="src">{{ line.src }}</span>
        <span class="input">{{ inputName(line.input) }}</span>
        <span class="sev-badge" :class="severityClass(line.sev)">{{ severityLabel(line.sev) }}</span>
        <span class="msg">{{ line.msg }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: flex-end;
  gap: var(--space-md);
}

.filter-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-family: var(--font-ui);
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.filter-label select {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}

.toolbar button {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
  transition: opacity var(--duration-fast) ease-out;
}

.toolbar button:hover {
  opacity: 0.85;
}

.tail-scroll {
  flex: 1;
  min-height: 320px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.empty {
  color: var(--color-text-muted);
  margin: 0;
}

.tail-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border);
  white-space: pre-wrap;
  word-break: break-all;
}

.tail-line:last-child {
  border-bottom: none;
}

.ts {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.src {
  color: var(--color-accent);
  flex-shrink: 0;
}

.input {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.sev-badge {
  flex-shrink: 0;
  font-size: 0.7rem;
  padding: 0 var(--space-xs);
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.sev-badge.sev-danger {
  background: var(--color-danger);
  color: var(--color-bg);
}

.sev-badge.sev-warn {
  background: var(--color-warn);
  color: var(--color-bg);
}

.sev-badge.sev-ok {
  background: var(--color-ok);
  color: var(--color-bg);
}

.msg {
  color: var(--color-text);
}
</style>
