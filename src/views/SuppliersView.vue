<script setup>
import { onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { suppliers } from '@/api/resources'

const auth = useAuthStore()
const confirmStore = useConfirmStore()

const list = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({ id: null, name: '', contact: '', phone: '', address: '', isActive: true })
const form = reactive(blank())

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await suppliers.list()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = () =>
  list.value.filter((s) =>
    `${s.name} ${s.contact ?? ''} ${s.phone ?? ''}`.toLowerCase().includes(search.value.toLowerCase()),
  )

function openNew() {
  Object.assign(form, blank())
  formError.value = ''
  modal.value = true
}
function openEdit(s) {
  Object.assign(form, {
    id: s.id,
    name: s.name,
    contact: s.contact ?? '',
    phone: s.phone ?? '',
    address: s.address ?? '',
    isActive: s.isActive,
  })
  formError.value = ''
  modal.value = true
}

async function save() {
  if (!form.name.trim()) return
  saving.value = true
  formError.value = ''
  const payload = {
    name: form.name.trim(),
    contact: form.contact || null,
    phone: form.phone || null,
    address: form.address || null,
    isActive: form.isActive,
  }
  try {
    if (form.id) await suppliers.update(form.id, payload)
    else await suppliers.create(payload)
    modal.value = false
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(s) {
  if (!(await confirmStore.ask(`Удалить поставщика «${s.name}»?`))) return
  try {
    await suppliers.remove(s.id)
    await load()
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по названию/контакту" />
      <button class="btn-primary btn-sm ml-auto" @click="openNew">
        <AppIcon name="plus" :size="16" /> Добавить
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <Spinner v-if="loading && !filtered().length" />
    <div v-if="filtered().length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="s in filtered()" :key="s.id" class="card-pad">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ s.name }}</div>
            <div v-if="!s.isActive" class="badge mt-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">не активен</div>
          </div>
          <button class="btn-ghost btn-sm shrink-0" @click="openEdit(s)"><AppIcon name="edit" :size="14" /></button>
        </div>
        <div v-if="s.contact" class="mt-2 text-sm text-slate-600 dark:text-slate-400">{{ s.contact }}</div>
        <div v-if="s.phone" class="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <AppIcon name="phone" :size="14" /> {{ s.phone }}
        </div>
        <div v-if="s.address" class="mt-1 flex items-start gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <AppIcon name="pin" :size="14" class="mt-0.5 shrink-0" /> {{ s.address }}
        </div>
        <button class="btn-ghost btn-sm mt-3 w-full text-red-600 dark:text-red-400" @click="remove(s)">Удалить</button>
      </div>
    </div>
    <EmptyState v-else-if="!loading" icon="truck" title="Поставщиков пока нет" />

    <ModalDialog v-if="modal" :title="form.id ? 'Поставщик' : 'Новый поставщик'" @close="modal = false" @submit="save">
      <div class="space-y-3">
        <div>
          <label class="label">Название</label>
          <input v-model="form.name" class="input" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Контактное лицо</label>
            <input v-model="form.contact" class="input" />
          </div>
          <div>
            <label class="label">Телефон</label>
            <input v-model="form.phone" class="input" />
          </div>
        </div>
        <div>
          <label class="label">Адрес</label>
          <input v-model="form.address" class="input" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300 bg-white text-indigo-600 dark:border-slate-700 dark:bg-slate-800" />
          Активен
        </label>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving || !form.name.trim()" @click="save">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
