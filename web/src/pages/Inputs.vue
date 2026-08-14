<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, ApiError } from '../api/client'
import EntityTable, { type EntityTableColumn } from '../components/EntityTable.vue'

const { t } = useI18n()

type Protocol = 'udp' | 'tcp'
interface Input {
  id: number
  name: string
  protocol: Protocol
  port: number
  enabled: boolean
}

const columns = computed<EntityTableColumn[]>(() => [
  { key: 'name', label: t('common.name') },
  { key: 'protocol', label: t('common.protocol') },
  { key: 'port', label: t('common.port') },
  { key: 'enabled', label: t('common.enabled') },
])

const inputs = ref<Input[]>([])
const loading = ref(false)
const errorMsg = ref('')
const showForm = ref(false)
const editingId = ref<number | null>(null)

const form = ref({ name: '', protocol: 'udp' as Protocol, port: 514, enabled: true })

function resetForm() {
  form.value = { name: '', protocol: 'udp', port: 514, enabled: true }
  editingId.value = null
}

async function load() {
  loading.value = true
  try {
    inputs.value = await api.get<Input[]>('/api/inputs')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('common.unknownError')
  } finally {
    loading.value = false
  }
}

function openAdd() {
  resetForm()
  errorMsg.value = ''
  showForm.value = true
}

function openEdit(row: Input) {
  editingId.value = row.id
  form.value = { name: row.name, protocol: row.protocol, port: row.port, enabled: row.enabled }
  errorMsg.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  errorMsg.value = ''
  resetForm()
}

async function submit() {
  errorMsg.value = ''
  const payload = {
    name: form.value.name,
    protocol: form.value.protocol,
    port: form.value.port,
    enabled: form.value.enabled,
  }
  try {
    if (editingId.value !== null) {
      await api.put(`/api/inputs/${editingId.value}`, payload)
    } else {
      await api.post('/api/inputs', payload)
    }
    closeForm()
    await load()
  } catch (e) {
    errorMsg.value = e instanceof ApiError || e instanceof Error ? e.message : t('common.unknownError')
  }
}

async function removeInput(row: Input) {
  if (!confirm(t('inputs.confirmDelete', { name: row.name }))) return
  try {
    await api.del(`/api/inputs/${row.id}`)
    await load()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('common.unknownError')
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <h1>{{ t('inputs.title') }}</h1>
    <p class="hint">
      {{ t('inputs.hintBefore') }}<code>FANOUT_PORT_RANGE</code>{{ t('inputs.hintAfter') }}
    </p>

    <div class="toolbar">
      <button type="button" data-test="add" @click="openAdd">{{ t('inputs.addButton') }}</button>
    </div>

    <p v-if="errorMsg && !showForm" role="alert" class="error">{{ errorMsg }}</p>

    <form v-if="showForm" @submit.prevent="submit" class="entity-form">
      <p v-if="errorMsg" role="alert" class="error">{{ errorMsg }}</p>
      <label>
        {{ t('common.name') }}
        <input data-test="name" v-model="form.name" type="text" required />
      </label>
      <label>
        {{ t('common.protocol') }}
        <select data-test="protocol" v-model="form.protocol">
          <option value="udp">udp</option>
          <option value="tcp">tcp</option>
        </select>
      </label>
      <label>
        {{ t('common.port') }}
        <input data-test="port" v-model.number="form.port" type="number" min="1" max="65535" required />
      </label>
      <label class="toggle">
        <input data-test="enabled" v-model="form.enabled" type="checkbox" />
        {{ t('common.enabled') }}
      </label>
      <div class="form-actions">
        <button type="submit">{{ editingId !== null ? t('common.save') : t('common.add') }}</button>
        <button type="button" @click="closeForm">{{ t('common.cancel') }}</button>
      </div>
    </form>

    <p v-if="loading">{{ t('common.loading') }}</p>
    <EntityTable v-else :columns="columns" :rows="inputs">
      <template #cell-enabled="{ row }">{{ row.enabled ? t('common.yes') : t('common.no') }}</template>
      <template #actions="{ row }">
        <button type="button" data-test="edit" @click="openEdit(row)">{{ t('common.edit') }}</button>
        <button type="button" data-test="delete" @click="removeInput(row)">{{ t('common.delete') }}</button>
      </template>
    </EntityTable>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.hint {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0;
}

.hint code {
  color: var(--color-text);
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.toolbar button {
  font-family: var(--font-ui);
  font-size: 0.9rem;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: none;
  background: var(--color-accent);
  color: var(--color-bg);
  cursor: pointer;
  transition: opacity var(--duration-fast) ease-out;
}

.toolbar button:hover {
  opacity: 0.85;
}

.entity-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  max-width: 360px;
}

.entity-form label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-family: var(--font-ui);
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.entity-form label.toggle {
  flex-direction: row;
  align-items: center;
  gap: var(--space-sm);
}

.entity-form input,
.entity-form select {
  font-family: var(--font-ui);
  font-size: 0.9rem;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}

.entity-form input:focus-visible,
.entity-form select:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.form-actions {
  display: flex;
  gap: var(--space-sm);
}

.form-actions button {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.form-actions button[type='submit'] {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: transparent;
}

.error {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  color: var(--color-danger);
  margin: 0;
}
</style>
