<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { setLocale, type Locale } from '../i18n'

const { locale, t } = useI18n({ useScope: 'global' })
const options: { value: Locale; label: string }[] = [
  { value: 'zh-TW', label: '繁中' },
  { value: 'en', label: 'EN' },
]
</script>

<template>
  <div class="lang-switcher" role="group" :aria-label="t('language.label')">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="lang-btn"
      :class="{ active: locale === opt.value }"
      :aria-pressed="locale === opt.value"
      :data-test="`lang-${opt.value}`"
      @click="setLocale(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.lang-switcher {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.lang-btn {
  font-family: var(--font-ui);
  font-size: 0.75rem;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color var(--duration-fast) ease-out, color var(--duration-fast) ease-out;
}

.lang-btn:hover {
  color: var(--color-text);
}

.lang-btn.active {
  background: var(--color-surface-raised);
  color: var(--color-accent);
}
</style>
