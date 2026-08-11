<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSession } from '../stores/session'
const pw = ref('')
const err = ref('')
const router = useRouter()
const session = useSession()
async function submit() {
  err.value = ''
  try {
    await session.login(pw.value)
    router.push('/')
  } catch (e) {
    err.value = (e as Error).message
  }
}
</script>
<template>
  <main class="login">
    <form @submit.prevent="submit" aria-labelledby="login-title">
      <h1 id="login-title">Rsyslog FanOut</h1>
      <input v-model="pw" type="password" placeholder="管理密碼" autocomplete="current-password" />
      <button type="submit">登入</button>
      <p v-if="err" role="alert" class="error">{{ err }}</p>
    </form>
  </main>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
}

.login form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: min(320px, 90vw);
  padding: var(--space-xl);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 0 rgb(255 255 255 / 4%) inset;
}

.login h1 {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  color: var(--color-text);
  margin: 0 0 var(--space-sm);
  letter-spacing: 0.02em;
}

.login input {
  font-family: var(--font-ui);
  font-size: 1rem;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}

.login input:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.login button {
  font-family: var(--font-ui);
  font-size: 1rem;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: none;
  background: var(--color-accent);
  color: var(--color-bg);
  cursor: pointer;
  transition: opacity var(--duration-fast) ease-out;
}

.login button:hover {
  opacity: 0.85;
}

.login .error {
  font-family: var(--font-ui);
  font-size: 0.875rem;
  color: var(--color-danger);
  margin: 0;
}
</style>
