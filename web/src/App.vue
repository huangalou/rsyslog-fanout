<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

// TODO(Task 12): dirty 徽章目前為靜態佔位，實際值由 useStats() 的 10 秒輪詢（GET /api/config/status）填入。
const dirty = ref(false)

const route = useRoute()
const isLoginPage = computed(() => route.path === '/login')

const navItems = [
  { path: '/', label: 'Dashboard' },
  { path: '/inputs', label: '接收設定' },
  { path: '/forwarding', label: '轉發設定' },
  { path: '/tail', label: 'Live Tail' },
  { path: '/sources', label: '來源狀態' },
]
</script>

<template>
  <RouterView v-if="isLoginPage" />
  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand">Rsyslog FanOut</div>
      <nav aria-label="主導覽">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-link">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <span v-if="dirty" class="badge-dirty" role="status">未套用變更</span>
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
