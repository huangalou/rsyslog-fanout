<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStats } from '../stores/stats'
import LineChart from '../components/LineChart.vue'
import StatusCard, { type StatusCardState } from '../components/StatusCard.vue'

const { t } = useI18n()
const stats = useStats()

const ratePoints = computed(() => stats.history.map((h) => ({ ts: h.ts, v: h.total })))

const inputEntries = computed(() => Object.entries(stats.snapshot?.inputs ?? {}))
const actionEntries = computed(() => Object.entries(stats.snapshot?.actions ?? {}))

const QUEUE_WARN_THRESHOLD = 1000

function actionState(action: { suspended: boolean; queueSize: number }): StatusCardState {
  if (action.suspended) return 'danger'
  if (action.queueSize > QUEUE_WARN_THRESHOLD) return 'warn'
  return 'ok'
}

onMounted(() => {
  stats.start()
})
onUnmounted(() => {
  stats.stop()
})
</script>

<template>
  <section class="page dashboard">
    <header class="dash-header">
      <h1>{{ t('nav.dashboard') }}</h1>
      <span v-if="stats.dirty" role="status" class="dirty-banner-wrap">
        <RouterLink to="/forwarding" class="dirty-banner">{{ t('dashboard.dirtyBanner') }}</RouterLink>
      </span>
    </header>

    <section class="chart-section" aria-labelledby="rate-heading">
      <h2 id="rate-heading">{{ t('dashboard.rateHeading') }}</h2>
      <LineChart :points="ratePoints" />
    </section>

    <section class="cards-section" aria-labelledby="inputs-heading">
      <h2 id="inputs-heading">{{ t('dashboard.inputsHeading') }}</h2>
      <div class="card-grid">
        <StatusCard
          v-for="[key, input] in inputEntries"
          :key="key"
          :title="key"
          :value="t('dashboard.inputValue', { rate: input.rate.toFixed(1), submitted: input.submitted })"
          state="ok"
        />
        <p v-if="inputEntries.length === 0" class="empty">{{ t('dashboard.emptyInputs') }}</p>
      </div>
    </section>

    <section class="cards-section" aria-labelledby="actions-heading">
      <h2 id="actions-heading">{{ t('dashboard.actionsHeading') }}</h2>
      <div class="card-grid">
        <StatusCard
          v-for="[key, action] in actionEntries"
          :key="key"
          :title="key"
          :value="t('dashboard.actionValue', { processed: action.processed, failed: action.failed, queueSize: action.queueSize })"
          :state="actionState(action)"
        />
        <p v-if="actionEntries.length === 0" class="empty">{{ t('dashboard.emptyActions') }}</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.dirty-banner {
  font-family: var(--font-ui);
  font-size: 0.875rem;
  color: var(--color-bg);
  background: var(--color-warn);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-sm);
  text-decoration: none;
  transition: opacity var(--duration-fast) ease-out;
}

.dirty-banner:hover {
  opacity: 0.85;
}

.chart-section,
.cards-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.chart-section h2,
.cards-section h2 {
  font-family: var(--font-ui);
  font-size: 0.95rem;
  color: var(--color-text-muted);
  margin: 0;
}

.chart-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
}

.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
}

.empty {
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: 0.875rem;
  margin: 0;
}
</style>
