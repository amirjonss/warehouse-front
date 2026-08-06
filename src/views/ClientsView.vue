<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { clientDebt, clients } from '@/api/resources'

const auth = useAuthStore()

const list = ref([])
const debtByClient = ref(new Map())
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
    const [clientList, debtList] = await Promise.all([clients.list(), clientDebt()])
    list.value = clientList
    debtByClient.value = new Map(debtList.map((d) => [String(d.id), d]))
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() =>
  list.value
    .filter((c) => `${c.name} ${c.contact ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(search.value.toLowerCase()))
    .map((c) => ({ ...c, debt: debtByClient.value.get(String(c.id)) ?? { debtUsd: '0', debtUzs: '0' } })),
)

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
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(c) {
  if (!confirm(`Удалить клиента «${c.name}»?`)) return
  try {
    await clients.remove(c.id)
    await load()
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по имени/контакту" />
      <button v-if="auth.can('clients.edit')" class="btn-primary btn-sm ml-auto" @click="openNew">
        <AppIcon name="plus" :size="16" /> Добавить
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div v-if="filtered.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="c in filtered" :key="c.id" class="card-pad">
        <div class="flex items-start justify-between gap-2">
          <RouterLink :to="`/clients/${c.id}`" class="min-w-0 font-medium text-slate-800 hover:text-blue-600">
            <div class="truncate">{{ c.name }}</div>
          </RouterLink>
          <button v-if="auth.can('clients.edit')" class="btn-ghost btn-sm shrink-0" @click="openEdit(c)">
            <AppIcon name="edit" :size="14" />
          </button>
        </div>
        <div v-if="!c.isActive" class="badge mt-1 bg-slate-100 text-slate-500">не активен</div>
        <div v-if="c.phone" class="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
          <AppIcon name="phone" :size="14" /> {{ c.phone }}
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-sm">
          <span class="text-slate-500">Долг</span>
          <span class="tabnum font-medium" :class="Number(c.debt.debtUsd) > 0 || Number(c.debt.debtUzs) > 0 ? 'text-amber-600' : 'text-emerald-600'">
            <template v-if="Number(c.debt.debtUsd) > 0">{{ money(c.debt.debtUsd, 'USD') }}</template>
            <template v-if="Number(c.debt.debtUsd) > 0 && Number(c.debt.debtUzs) > 0"> + </template>
            <template v-if="Number(c.debt.debtUzs) > 0">{{ money(c.debt.debtUzs, 'UZS') }}</template>
            <template v-if="Number(c.debt.debtUsd) <= 0 && Number(c.debt.debtUzs) <= 0">рассчитался</template>
          </span>
        </div>
      </div>
    </div>
    <EmptyState v-else-if="!loading" icon="users" title="Клиентов пока нет" />

    <ModalDialog v-if="modal" :title="form.id ? 'Клиент' : 'Новый клиент'" @close="modal = false">
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
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
          Активен
        </label>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ formError }}</p>
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
