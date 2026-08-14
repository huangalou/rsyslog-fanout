<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useStats } from './stores/stats'
import LanguageSwitcher from './components/LanguageSwitcher.vue'

// dirty 徽章讀取 useStats().dirty；輪詢本身只在 Dashboard 掛載期間執行
// （stats.start()/stop() 綁定 Dashboard 的 onMounted/onUnmounted）。
// 離開 Dashboard 後徽章會停在最後一次輪詢結果，不會繼續更新——
// 這是刻意選擇的簡單做法：避免在 App 層重複維護一份輪詢/WS 生命週期。
const stats = useStats()
const dirty = computed(() => stats.dirty)

const route = useRoute()
const isLoginPage = computed(() => route.path === '/login')

const { t } = useI18n()
const navItems = computed(() => [
  { path: '/', label: t('nav.dashboard') },
  { path: '/inputs', label: t('nav.inputs') },
  { path: '/forwarding', label: t('nav.forwarding') },
  { path: '/tail', label: t('nav.tail') },
  { path: '/sources', label: t('nav.sources') },
])
</script>

<template>
  <RouterView v-if="isLoginPage" />
  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand">Rsyslog FanOut</div>
      <nav :aria-label="t('nav.main')">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-link">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <span v-if="dirty" class="badge-dirty" role="status">{{ t('app.dirtyBadge') }}</span>
        <LanguageSwitcher />
      </header>
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
  background: var(--color-bg);
}

.sidebar {
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: var(--space-lg) var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.brand {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  color: var(--color-text);
  letter-spacing: 0.02em;
}

.sidebar nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.nav-link {
  font-family: var(--font-ui);
  font-size: 0.9rem;
  color: var(--color-text-muted);
  text-decoration: none;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  transition: background-color var(--duration-fast) ease-out, color var(--duration-fast) ease-out;
}

.nav-link:hover {
  background: var(--color-surface-raised);
  color: var(--color-text);
}

.nav-link.router-link-exact-active {
  background: var(--color-surface-raised);
  color: var(--color-accent);
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-md);
  padding: 0 var(--space-lg);
  border-bottom: 1px solid var(--color-border);
}

.badge-dirty {
  font-family: var(--font-ui);
  font-size: 0.8rem;
  color: var(--color-bg);
  background: var(--color-warn);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
}

.content {
  flex: 1;
  padding: var(--space-xl);
  overflow: auto;
}

.content :deep(.page h1) {
  font-family: var(--font-ui);
  font-size: 1.25rem;
  color: var(--color-text);
}

.content :deep(.page p) {
  color: var(--color-text-muted);
}
</style>
