<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, ApiError } from '../api/client'
import EntityTable, { type EntityTableColumn } from '../components/EntityTable.vue'

type Protocol = 'udp' | 'tcp'
interface Input {
  id: number
  name: string
  protocol: Protocol
  port: number
  enabled: boolean
}

const columns: EntityTableColumn[] = [
  { key: 'name', label: '名稱' },
  { key: 'protocol', label: '協定' },
  { key: 'port', label: '埠號' },
  { key: 'enabled', label: '啟用' },
]

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
    errorMsg.value = e instanceof Error ? e.message : '未知錯誤'
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
    errorMsg.value = e instanceof ApiError || e instanceof Error ? e.message : '未知錯誤'
  }
}

async function removeInput(row: Input) {
  if (!confirm(`確定要刪除接收設定「${row.name}」？`)) return
  try {
    await api.del(`/api/inputs/${row.id}`)
    await load()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '未知錯誤'
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <h1>接收設定</h1>
    <p class="hint">
      允許的監聽埠範圍由環境變數 <code>FANOUT_PORT_RANGE</code> 決定，需與 docker-compose 對外發布的埠一致（預設 514、5140-5199）。
    </p>

    <div class="toolbar">
      <button type="button" data-test="add" @click="openAdd">新增接收設定</button>
    </div>

    <p v-if="errorMsg && !showForm" role="alert" class="error">{{ errorMsg }}</p>

    <form v-if="showForm" @submit.prevent="submit" class="entity-form">
      <p v-if="errorMsg" role="alert" class="error">{{ errorMsg }}</p>
      <label>
        名稱
        <input data-test="name" v-model="form.name" type="text" required />
      </label>
      <label>
        協定
        <select data-test="protocol" v-model="form.protocol">
          <option value="udp">udp</option>
          <option value="tcp">tcp</option>
        </select>
      </label>
      <label>
        埠號
        <input data-test="port" v-model.number="form.port" type="number" min="1" max="65535" required />
      </label>
      <label class="toggle">
        <input data-test="enabled" v-model="form.enabled" type="checkbox" />
        啟用
      </label>
      <div class="form-actions">
        <button type="submit">{{ editingId !== null ? '儲存' : '新增' }}</button>
        <button type="button" @click="closeForm">取消</button>
      </div>
    </form>

    <p v-if="loading">載入中…</p>
    <EntityTable v-else :columns="columns" :rows="inputs">
      <template #cell-enabled="{ row }">{{ row.enabled ? '是' : '否' }}</template>
      <template #actions="{ row }">
        <button type="button" data-test="edit" @click="openEdit(row)">編輯</button>
        <button type="button" data-test="delete" @click="removeInput(row)">刪除</button>
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
