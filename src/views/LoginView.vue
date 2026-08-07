<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!email.value || !password.value) return
  loading.value = true
  error.value = ''
  try {
    await auth.login(email.value, password.value)
    router.push(route.query.next ?? '/')
  } catch (e) {
    error.value = e.status === 401 ? 'Неверный email или пароль' : e.message || 'Не удалось войти'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 flex flex-col items-center text-center">
        <div class="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
          <AppIcon name="boxes" :size="28" />
        </div>
        <h1 class="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">Wirehouse</h1>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Складской учёт</p>
      </div>

      <form class="card-pad sm:p-6" @submit.prevent="submit">
        <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Вход в систему</div>

        <div class="mt-4">
          <label class="label">Email</label>
          <input v-model="email" type="email" class="input" autocomplete="username" required />
        </div>
        <div class="mt-3">
          <label class="label">Пароль</label>
          <input
            v-model="password"
            type="password"
            class="input"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="error" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {{ error }}
        </p>

        <button type="submit" class="btn-primary mt-4 w-full" :disabled="loading">
          {{ loading ? 'Входим…' : 'Войти' }}
        </button>
      </form>

      <p class="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
        Учётную запись создаёт администратор. Если у вас нет доступа — обратитесь к нему.
      </p>
    </div>
  </div>
</template>
