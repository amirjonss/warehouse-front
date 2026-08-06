<script setup>
import { onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date } from '@/utils/format'
import { users } from '@/api/resources'

const ROLE_TITLES = { ROLE_ADMIN: 'Администратор', ROLE_SALES: 'Продавец' }

const list = ref([])
const loading = ref(true)
const error = ref('')
const modal = ref(false)
const creating = ref(false)
const formError = ref('')

const form = reactive({ email: '', role: 'ROLE_SALES' })
const created = ref(null) // { email, password } — показываем один раз

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await users.list()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

function roleOf(u) {
  if (u.roles?.includes('ROLE_ADMIN')) return 'ROLE_ADMIN'
  if (u.roles?.includes('ROLE_SALES')) return 'ROLE_SALES'
  return null
}

function openNew() {
  form.email = ''
  form.role = 'ROLE_SALES'
  created.value = null
  formError.value = ''
  modal.value = true
}

async function save() {
  if (!form.email.trim()) return
  creating.value = true
  formError.value = ''
  try {
    const result = await users.create({ email: form.email.trim(), roles: [form.role] })
    created.value = { email: result.email, password: result.password }
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    creating.value = false
  }
}

async function block(u) {
  if (!confirm(`Заблокировать доступ для ${u.email}? Это необратимо — создать новый аккаунт можно, а вернуть этот нельзя.`)) return
  try {
    await users.remove(u.id)
    await load()
  } catch (e) {
    error.value = e.message
  }
}

function copyPassword() {
  navigator.clipboard?.writeText(created.value.password)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="text-sm text-slate-500">Всего сотрудников: {{ list.length }}</div>
      <button class="btn-primary btn-sm" @click="openNew">
        <AppIcon name="plus" :size="16" /> Добавить сотрудника
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div v-if="list.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="u in list" :key="u.id" class="card-pad">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate font-medium text-slate-800">{{ u.email }}</div>
            <div class="text-xs text-slate-500">{{ ROLE_TITLES[roleOf(u)] ?? '—' }}</div>
          </div>
        </div>
        <div class="mt-2 text-xs text-slate-400">Создан {{ date(u.createdAt) }}</div>
        <button class="btn-ghost btn-sm mt-3 w-full text-red-600" @click="block(u)">Заблокировать</button>
      </div>
    </div>
    <EmptyState v-else-if="!loading" icon="shield" title="Сотрудников пока нет" />

    <ModalDialog v-if="modal" title="Новый сотрудник" @close="modal = false">
      <div v-if="!created" class="space-y-3">
        <div>
          <label class="label">Email</label>
          <input v-model="form.email" type="email" class="input" />
        </div>
        <div>
          <label class="label">Роль</label>
          <div class="flex gap-2">
            <button
              type="button"
              v-for="(title, key) in ROLE_TITLES"
              :key="key"
              class="btn-ghost btn-sm flex-1"
              :class="{ 'border-blue-500 bg-blue-50 text-blue-700': form.role === key }"
              @click="form.role = key"
            >
              {{ title }}
            </button>
          </div>
        </div>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ formError }}</p>
      </div>

      <div v-else class="space-y-3">
        <p class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Аккаунт создан. Пароль показывается один раз — сохраните и передайте сотруднику.
        </p>
        <div class="rounded-lg border border-slate-200 p-3">
          <div class="text-xs text-slate-500">Email</div>
          <div class="font-mono text-sm">{{ created.email }}</div>
          <div class="mt-2 text-xs text-slate-500">Пароль</div>
          <div class="flex items-center gap-2">
            <div class="font-mono text-sm">{{ created.password }}</div>
            <button class="btn-ghost btn-sm" @click="copyPassword"><AppIcon name="download" :size="14" /> Копировать</button>
          </div>
        </div>
      </div>

      <template #footer>
        <template v-if="!created">
          <button class="btn-ghost" @click="modal = false">Отмена</button>
          <button class="btn-primary" :disabled="creating || !form.email.trim()" @click="save">Создать</button>
        </template>
        <button v-else class="btn-primary" @click="modal = false">Готово</button>
      </template>
    </ModalDialog>
  </div>
</template>
