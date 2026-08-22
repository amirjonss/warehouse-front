<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Spinner from '@/components/Spinner.vue'
import Pagination from '@/components/Pagination.vue'
import { money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'
import { clients } from '@/api/resources'

const auth = useAuthStore()
const confirmStore = useConfirmStore()

const loading = ref(true)
const error = ref('')
const search = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({ id: null, name: '', contact: '', phone: '', address: '', isActive: true })
const form = reactive(blank())

/** Поиск уходит на бэкенд (?name=...) только от 2 символов и с задержкой. */
const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => {
  const s = debouncedSearch.value.trim()
  return s.length >= 2 ? s : ''
})

const page = ref(1)
const pageSize = 20
const pageItems = ref([])
const totalItems = ref(0)

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize }
    if (searchQuery.value) params.name = searchQuery.value
    const { items, totalItems: total } = await api.getPage('/clients', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(() => loadPage(1))

watch(searchQuery, () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

function openNew() {
  Object.assign(form, blank())
  formError.value = ''
  modal.value = true
}
function openEdit(c) {
  Object.assign(form, {
    id: c.id,
    name: c.name,
    contact: c.contact ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    isActive: c.isActive,
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
    if (form.id) await clients.update(form.id, payload)
    else await clients.create(payload)
    modal.value = false
    await loadPage(page.value)
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(c) {
  if (!(await confirmStore.ask(`Удалить клиента «${c.name}»?`))) return
  try {
    await clients.remove(c.id)
    await loadPage(page.value)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по имени" />
      <button v-if="auth.can('clients.edit')" class="btn-primary btn-sm ml-auto" @click="openNew">
        <AppIcon name="plus" :size="16" /> Добавить
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <Spinner v-if="loading && !pageItems.length" />
    <div v-if="pageItems.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="c in pageItems" :key="c.id" class="card-pad">
        <div class="flex items-start justify-between gap-2">
          <RouterLink :to="`/clients/${c.id}`" class="min-w-0 font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">
            <div class="truncate">{{ c.name }}</div>
          </RouterLink>
          <button v-if="auth.can('clients.edit')" class="btn-ghost btn-sm shrink-0" @click="openEdit(c)">
            <AppIcon name="edit" :size="14" />
          </button>
        </div>
        <div v-if="!c.isActive" class="badge mt-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">не активен</div>
        <div v-if="c.phone" class="mt-2 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <AppIcon name="phone" :size="14" /> {{ c.phone }}
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-2.5 text-sm">
          <span class="text-slate-500 dark:text-slate-400">Долг</span>
          <span class="tabnum font-medium" :class="Number(c.debtUsd) > 0 || Number(c.debtUzs) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
            <template v-if="Number(c.debtUsd) > 0">{{ money(c.debtUsd, 'USD') }}</template>
            <template v-if="Number(c.debtUsd) > 0 && Number(c.debtUzs) > 0"> + </template>
            <template v-if="Number(c.debtUzs) > 0">{{ money(c.debtUzs, 'UZS') }}</template>
            <template v-if="Number(c.debtUsd) <= 0 && Number(c.debtUzs) <= 0">рассчитался</template>
          </span>
        </div>
      </div>
    </div>
    <EmptyState v-else-if="!loading" icon="users" title="Клиентов пока нет" />

    <Pagination
      v-if="pageItems.length"
      class="card"
      :page="page"
      :total-pages="totalPages"
      :total-items="totalItems"
      :page-size="pageSize"
      @update:page="page = $event"
    />

    <ModalDialog v-if="modal" :title="form.id ? 'Клиент' : 'Новый клиент'" @close="modal = false" @submit="save">
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
        <button v-if="form.id && auth.can('clients.delete')" class="btn-danger" @click="remove(form); modal = false">
          Удалить
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
