<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

export interface LineChartPoint {
  ts: number
  v: number
}

const props = defineProps<{ points: LineChartPoint[] }>()

const WIDTH = 640
const HEIGHT = 160
const PAD_X = 12
const PAD_Y = 12

// 動畫僅使用 opacity（compositor-friendly），mounted 後才淡入。
const mounted = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    mounted.value = true
  })
})

const scaled = computed(() => {
  const pts = props.points
  if (pts.length === 0) return null
  const tsList = pts.map((p) => p.ts)
  const vList = pts.map((p) => p.v)
  const minTs = Math.min(...tsList)
  const maxTs = Math.max(...tsList)
  const minV = Math.min(0, ...vList)
  const maxV = Math.max(1, ...vList)
  const tsSpan = maxTs - minTs || 1
  const vSpan = maxV - minV || 1
  const xOf = (ts: number) => PAD_X + ((ts - minTs) / tsSpan) * (WIDTH - PAD_X * 2)
  const yOf = (v: number) => HEIGHT - PAD_Y - ((v - minV) / vSpan) * (HEIGHT - PAD_Y * 2)
  const coords = pts.map((p) => ({ x: xOf(p.ts), y: yOf(p.v) }))
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const baseline = (HEIGHT - PAD_Y).toFixed(1)
  const area = `${PAD_X.toFixed(1)},${baseline} ${line} ${(WIDTH - PAD_X).toFixed(1)},${baseline}`
  return { line, area, latest: pts.at(-1)?.v ?? 0, max: maxV }
})
</script>

<template>
  <div class="line-chart">
    <svg v-if="scaled" viewBox="0 0 640 160" preserveAspectRatio="none" role="img" :aria-label="t('chart.ariaLabel')">
      <line x1="12" y1="80" x2="628" y2="80" class="gridline" />
      <polygon :points="scaled.area" class="area" :class="{ visible: mounted }" />
      <polyline :points="scaled.line" class="line" :class="{ visible: mounted }" />
    </svg>
    <p v-else class="empty">{{ t('chart.empty') }}</p>
  </div>
</template>

<style scoped>
.line-chart {
  width: 100%;
}

svg {
  width: 100%;
  height: 160px;
  display: block;
}

.gridline {
  stroke: var(--color-border);
  stroke-width: 1;
}

.area {
  fill: var(--color-accent);
  fill-opacity: 0.12;
  stroke: none;
  opacity: 0;
  transition: opacity var(--duration-normal) ease-out;
}

.area.visible {
  opacity: 1;
}

.line {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 2;
  opacity: 0;
  transition: opacity var(--duration-normal) ease-out;
}

.line.visible {
  opacity: 1;
}

.empty {
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: 0.875rem;
  padding: var(--space-lg) 0;
  text-align: center;
  margin: 0;
}
</style>
