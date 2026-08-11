<script setup lang="ts">
export type StatusCardState = 'ok' | 'warn' | 'danger' | 'neutral'

defineProps<{
  title: string
  value: string | number
  state?: StatusCardState
}>()
</script>

<template>
  <article class="status-card" :class="`state-${state ?? 'neutral'}`">
    <span class="title">{{ title }}</span>
    <span class="value">{{ value }}</span>
  </article>
</template>

<style scoped>
.status-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 180px;
}

.title {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
}

.value {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  color: var(--color-text);
}

.state-ok {
  border-left-color: var(--color-ok);
}

.state-warn {
  border-left-color: var(--color-warn);
}

.state-danger {
  border-left-color: var(--color-danger);
}

.state-neutral {
  border-left-color: var(--color-border);
}
</style>
