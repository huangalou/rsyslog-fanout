<script setup lang="ts">
// 轉發設定頁：Destinations（CRUD）+ Routes（RouteMatrix 勾選建/刪 route，⚙ 設定過濾條件）+ 套用設定。
// routes 沒有 PUT 端點（見 server/src/routes/crud.ts），編輯既有 route 的過濾條件
// 因此實作為「刪除舊 route、以新過濾條件建立同一組 inputId/destinationId 的新 route」。
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, ApiError } from '../api/client'
import EntityTable, { type EntityTableColumn } from '../components/EntityTable.vue'
import RouteMatrix from '../components/RouteMatrix.vue'
import RouteFilterForm, { type RouteFilterValue } from '../components/RouteFilterForm.vue'

type Protocol = 'udp' | 'tcp'
type HeaderMode = 'raw' | 'standard'

interface Input {
  id: number
  name: string
  protocol: Protocol
  port: number
  enabled: boolean
}
interface Destination {
  id: number
  name: string
  protocol: Protocol
  host: string
  port: number
  headerMode: HeaderMode
  enabled: boolean
}
interface RouteRule {
  id: number
  inputId: number
  destinationId: number
  sourceFilter: string | null
  facilities: number[] | null
  maxSeverity: number | null
}
interface ApplyResult {
  applied: boolean
  stage?: 'validate' | 'restart'
  error?: string
}
interface ConfigStatus {
  dirty: boolean
  lastResult: ApplyResult | null
}

const { t } = useI18n()

const destColumns = computed<EntityTableColumn[]>(() => [
  { key: 'name', label: t('common.name') },
  { key: 'protocol', label: t('common.protocol') },
  { key: 'hostPort', label: t('forwarding.hostPortCol') },
  { key: 'headerMode', label: t('forwarding.headerMode') },
  { key: 'enabled', label: t('common.enabled') },
])

const inputs = ref<Input[]>([])
const destinations = ref<Destination[]>([])
const routes = ref<RouteRule[]>([])
const status = ref<ConfigStatus>({ dirty: false, lastResult: null })
const loading = ref(false)

// --- Destinations CRUD ---
const showDestForm = ref(false)
const editingDestId = ref<number | null>(null)
const destErrorMsg = ref('')
const destForm = ref({
  name: '',
  protocol: 'udp' as Protocol,
  host: '',
  port: 514,
  headerMode: 'raw' as HeaderMode,
  enabled: true,
})

function resetDestForm() {
  destForm.value = { name: '', protocol: 'udp', host: '', port: 514, headerMode: 'raw', enabled: true }
  editingDestId.value = null
}

function openAddDest() {
  resetDestForm()
  destErrorMsg.value = ''
  showDestForm.value = true
}

function openEditDest(row: Destination) {
  editingDestId.value = row.id
  destForm.value = {
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    headerMode: row.headerMode,
    enabled: row.enabled,
  }
  destErrorMsg.value = ''
  showDestForm.value = true
}

function closeDestForm() {
  showDestForm.value = false
  destErrorMsg.value = ''
  resetDestForm()
}

async function submitDest() {
  destErrorMsg.value = ''
  const payload = {
    name: destForm.value.name,
    protocol: destForm.value.protocol,
    host: destForm.value.host,
    port: destForm.value.port,
    headerMode: destForm.value.headerMode,
    enabled: destForm.value.enabled,
  }
  try {
    if (editingDestId.value !== null) {
      await api.put(`/api/destinations/${editingDestId.value}`, payload)
    } else {
      await api.post('/api/destinations', payload)
    }
    closeDestForm()
    await loadDestinations()
  } catch (e) {
    destErrorMsg.value = e instanceof ApiError || e instanceof Error ? e.message : t('common.unknownError')
  }
}

async function removeDest(row: Destination) {
  if (!confirm(t('forwarding.confirmDeleteDest', { name: row.name }))) return
  try {
    await api.del(`/api/destinations/${row.id}`)
    await loadDestinations()
  } catch (e) {
    destErrorMsg.value = e instanceof Error ? e.message : t('common.unknownError')
  }
}

// --- Routes（RouteMatrix）---
const routeErrorMsg = ref('')

interface EditingFilter {
  inputId: number
  destinationId: number
  value: RouteFilterValue
}
const editingFilter = ref<EditingFilter | null>(null)

function findRoute(inputId: number, destinationId: number): RouteRule | undefined {
  return routes.value.find((r) => r.inputId === inputId && r.destinationId === destinationId)
}

async function onToggleRoute(inputId: number, destinationId: number, checked: boolean) {
  routeErrorMsg.value = ''
  try {
    if (checked) {
      await api.post('/api/routes', { inputId, destinationId, sourceFilter: null, facilities: null, maxSeverity: null })
    } else {
      const existing = findRoute(inputId, destinationId)
      if (existing) await api.del(`/api/routes/${existing.id}`)
    }
    await loadRoutes()
  } catch (e) {
    routeErrorMsg.value = e instanceof Error ? e.message : t('common.unknownError')
  }
}

function onEditFilter(inputId: number, destinationId: number) {
  const existing = findRoute(inputId, destinationId)
  editingFilter.value = {
    inputId,
    destinationId,
    value: {
      sourceFilter: existing?.sourceFilter ?? null,
      facilities: existing?.facilities ?? null,
      maxSeverity: existing?.maxSeverity ?? null,
    },
  }
}

function cancelEditFilter() {
  editingFilter.value = null
}

async function saveFilter(value: RouteFilterValue) {
  if (!editingFilter.value) return
  const { inputId, destinationId } = editingFilter.value
  routeErrorMsg.value = ''
  const existing = findRoute(inputId, destinationId)
  try {
    if (existing) await api.del(`/api/routes/${existing.id}`)
    await api.post('/api/routes', { inputId, destinationId, ...value })
    editingFilter.value = null
  } catch (e) {
    // 沒有 PUT /api/routes/:id，編輯過濾條件實作為「先刪舊 route、再建新 route」。
    // 若舊 route 已刪除但新 route 建立失敗（例如 sourceFilter 未通過驗證），
    // 本地 routes 狀態會與後端不一致，因此無論成功或失敗都要 reload 讓畫面對齊後端真實狀態，
    // 並提示使用者原本的過濾條件已被移除、需要重新設定。
    routeErrorMsg.value = existing
      ? t('forwarding.filterUpdateFailed', { error: e instanceof Error ? e.message : t('common.unknownError') })
      : e instanceof Error
        ? e.message
        : t('common.unknownError')
  } finally {
    await loadRoutes()
  }
}

// --- 套用設定 ---
const applying = ref(false)
const applySuccessVisible = ref(false)
const applyError = ref('')

async function applyConfig() {
  applying.value = true
  applySuccessVisible.value = false
  applyError.value = ''
  try {
    const result = await api.post<ApplyResult>('/api/config/apply', undefined)
    if (result.applied) applySuccessVisible.value = true
    await loadStatus()
  } catch (e) {
    applyError.value = e instanceof Error ? e.message : t('forwarding.applyFailed')
  } finally {
    applying.value = false
  }
}

// --- 載入 ---
async function loadInputs() {
  inputs.value = await api.get<Input[]>('/api/inputs')
}
async function loadDestinations() {
  destinations.value = await api.get<Destination[]>('/api/destinations')
}
async function loadRoutes() {
  routes.value = await api.get<RouteRule[]>('/api/routes')
}
async function loadStatus() {
  status.value = await api.get<ConfigStatus>('/api/config/status')
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadInputs(), loadDestinations(), loadRoutes(), loadStatus()])
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <section class="page">
    <h1>{{ t('forwarding.title') }}</h1>

    <!-- Destinations 區 -->
    <section class="block">
      <div class="block-header">
        <h2>{{ t('forwarding.destHeading') }}</h2>
        <button type="button" data-test="add-dest" @click="openAddDest">{{ t('forwarding.addDest') }}</button>
      </div>

      <p v-if="destErrorMsg && !showDestForm" role="alert" class="error">{{ destErrorMsg }}</p>

      <form v-if="showDestForm" @submit.prevent="submitDest" class="entity-form">
        <p v-if="destErrorMsg" role="alert" class="error">{{ destErrorMsg }}</p>
        <label>
          {{ t('common.name') }}
          <input data-test="dest-name" v-model="destForm.name" type="text" required />
        </label>
        <label>
          {{ t('common.protocol') }}
          <select data-test="dest-protocol" v-model="destForm.protocol">
            <option value="udp">udp</option>
            <option value="tcp">tcp</option>
          </select>
        </label>
        <label>
          {{ t('forwarding.host') }}
          <input data-test="dest-host" v-model="destForm.host" type="text" required />
        </label>
        <label>
          {{ t('common.port') }}
          <input data-test="dest-port" v-model.number="destForm.port" type="number" min="1" max="65535" required />
        </label>
        <fieldset class="header-mode">
          <legend>{{ t('forwarding.headerMode') }}</legend>
          <label class="radio-option">
            <input data-test="dest-headerMode-raw" type="radio" value="raw" v-model="destForm.headerMode" />
            <span><code>raw</code>{{ t('forwarding.headerModeRawSuffix') }}{{ t('forwarding.headerModeRaw') }}</span>
          </label>
          <label class="radio-option">
            <input data-test="dest-headerMode-standard" type="radio" value="standard" v-model="destForm.headerMode" />
            <span><code>standard</code>{{ t('forwarding.headerModeStandard') }}</span>
          </label>
        </fieldset>
        <label class="toggle">
          <input data-test="dest-enabled" v-model="destForm.enabled" type="checkbox" />
          {{ t('common.enabled') }}
        </label>
        <div class="form-actions">
          <button type="submit">{{ editingDestId !== null ? t('common.save') : t('common.add') }}</button>
          <button type="button" @click="closeDestForm">{{ t('common.cancel') }}</button>
        </div>
      </form>

      <p v-if="loading">{{ t('common.loading') }}</p>
      <EntityTable v-else :columns="destColumns" :rows="destinations">
        <template #cell-hostPort="{ row }">{{ row.host }}:{{ row.port }}</template>
        <template #cell-headerMode="{ row }">{{ row.headerMode }}</template>
        <template #cell-enabled="{ row }">{{ row.enabled ? t('common.yes') : t('common.no') }}</template>
        <template #actions="{ row }">
          <button type="button" data-test="dest-edit" @click="openEditDest(row)">{{ t('common.edit') }}</button>
          <button type="button" data-test="dest-delete" @click="removeDest(row)">{{ t('common.delete') }}</button>
        </template>
      </EntityTable>
    </section>

    <!-- Routes 區 -->
    <section class="block">
      <h2>{{ t('forwarding.routeMatrixHeading') }}</h2>
      <p class="hint">{{ t('forwarding.routeHint') }}</p>
      <p v-if="routeErrorMsg" role="alert" class="error">{{ routeErrorMsg }}</p>
      <RouteMatrix
        :inputs="inputs"
        :destinations="destinations"
        :routes="routes"
        @toggle="onToggleRoute"
        @edit-filter="onEditFilter"
      />
      <RouteFilterForm
        v-if="editingFilter"
        :model-value="editingFilter.value"
        @save="saveFilter"
        @cancel="cancelEditFilter"
      />
    </section>

    <!-- 套用區 -->
    <section class="block apply-block">
      <div class="apply-row">
        <button type="button" data-test="apply" :disabled="applying" @click="applyConfig">{{ t('forwarding.applyButton') }}</button>
        <span v-if="status.dirty" class="badge-dirty" role="status" data-test="dirty-badge">{{ t('forwarding.dirtyBadge') }}</span>
      </div>
      <p v-if="applySuccessVisible" class="toast-success" role="status" data-test="apply-success">{{ t('forwarding.applySuccess') }}</p>
      <pre v-if="applyError" class="apply-error" data-test="apply-error">{{ applyError }}</pre>
    </section>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.block-header button,
.apply-row button {
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

.block-header button:hover,
.apply-row button:hover {
  opacity: 0.85;
}

.hint {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0;
}

.entity-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  max-width: 420px;
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

.header-mode {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.header-mode legend {
  font-family: var(--font-ui);
  font-size: 0.8rem;
  color: var(--color-text-muted);
  padding: 0 var(--space-xs);
}

.radio-option {
  flex-direction: row !important;
  align-items: flex-start;
  gap: var(--space-xs);
}

.radio-option input {
  margin-top: 3px;
}

.radio-option span {
  font-family: var(--font-ui);
  font-size: 0.8rem;
  color: var(--color-text);
}

.radio-option code {
  color: var(--color-accent);
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

.apply-block {
  padding: var(--space-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.apply-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.badge-dirty {
  font-family: var(--font-ui);
  font-size: 0.8rem;
  color: var(--color-bg);
  background: var(--color-warn);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
}

.toast-success {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  color: var(--color-bg);
  background: var(--color-ok);
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  margin-top: var(--space-sm);
}

.apply-error {
  margin-top: var(--space-sm);
  max-height: 240px;
  overflow: auto;
  padding: var(--space-md);
  background: var(--color-bg);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  color: var(--color-danger);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
