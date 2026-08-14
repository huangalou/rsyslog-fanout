<script setup lang="ts">
// 單一 route 的過濾條件編輯表單（sourceFilter / facilities / maxSeverity）。
// 由 RouteMatrix 的「⚙」按鈕開啟；儲存/取消由呼叫端（Forwarding.vue）決定實際 API 呼叫，
// 本元件只負責蒐集輸入值並以 emit 交出。
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

export interface RouteFilterValue {
  sourceFilter: string | null
  facilities: number[] | null
  maxSeverity: number | null
}

const FACILITY_NAMES = [
  'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news',
  'uucp', 'cron', 'authpriv', 'ftp', 'ntp', 'logaudit', 'logalert', 'clock',
  'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7',
]

const SEVERITY_NAMES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']

const props = defineProps<{ modelValue: RouteFilterValue }>()
const emit = defineEmits<{
  save: [value: RouteFilterValue]
  cancel: []
}>()

const sourceFilter = ref(props.modelValue.sourceFilter ?? '')
const facilities = ref<number[]>(props.modelValue.facilities ?? [])
const maxSeverity = ref<number | ''>(props.modelValue.maxSeverity ?? '')

function submit() {
  emit('save', {
    sourceFilter: sourceFilter.value.trim() === '' ? null : sourceFilter.value.trim(),
    facilities: facilities.value.length > 0 ? [...facilities.value] : null,
    maxSeverity: maxSeverity.value === '' ? null : maxSeverity.value,
  })
}
</script>

<template>
  <form class="filter-form" @submit.prevent="submit">
    <label>
      {{ t('routeFilter.sourceFilter') }}
      <input data-test="filter-source" v-model="sourceFilter" type="text" :placeholder="t('routeFilter.sourcePlaceholder')" />
    </label>
    <label>
      {{ t('routeFilter.facilities') }}
      <select data-test="filter-facilities" v-model.number="facilities" multiple size="6">
        <option v-for="(fname, idx) in FACILITY_NAMES" :key="idx" :value="idx">{{ idx }} {{ fname }}</option>
      </select>
    </label>
    <label>
      {{ t('routeFilter.maxSeverity') }}
      <select data-test="filter-severity" v-model="maxSeverity">
        <option value="">{{ t('routeFilter.noLimit') }}</option>
        <option v-for="(sname, idx) in SEVERITY_NAMES" :key="idx" :value="idx">{{ sname }}({{ idx }})</option>
      </select>
    </label>
    <div class="filter-form-actions">
      <button type="submit">{{ t('common.save') }}</button>
      <button type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
    </div>
  </form>
</template>

<style scoped>
.filter-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 260px;
}

.filter-form label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-family: var(--font-ui);
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.filter-form input,
.filter-form select {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}

.filter-form-actions {
  display: flex;
  gap: var(--space-sm);
}

.filter-form-actions button {
  font-family: var(--font-ui);
  font-size: 0.8rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.filter-form-actions button[type='submit'] {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: transparent;
}
</style>
