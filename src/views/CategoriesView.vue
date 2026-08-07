<script setup>
import { onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { categories } from '@/api/resources'

const auth = useAuthStore()

const list = ref([])
const loading = ref(true)
const error = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({ id: null, slug: '', name: '', sortOrder: null })
const form = reactive(blank())

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await categories.list({ 'order[sortOrder]': 'asc' })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openNew() {
  Object.assign(form, blank())
  formError.value = ''
  modal.value = true
}
function openEdit(c) {
  Object.assign(form, { id: c.id, slug: c.slug, name: c.name, sortOrder: c.sortOrder })
  formError.value = ''
  modal.value = true
}

async function save() {
  if (!form.name.trim() || !form.slug.trim()) return
  saving.value = true
  formError.value = ''
  const payload = {
    slug: form.slug.trim(),
    name: form.name.trim(),
    sortOrder: form.sortOrder === null || form.sortOrder === '' ? null : Number(form.sortOrder),
  }
  try {
    if (form.id) await categories.update(form.id, payload)
    else await categories.create(payload)
    modal.value = false
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(c) {
  if (!confirm(`Удалить категорию «${c.name}»?`)) return
  try {
    await categories.remove(c.id)
    await load()
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="text-sm text-slate-500 dark:text-slate-400">Всего категорий: {{ list.length }}</div>
      <button v-if="auth.can('categories')" class="btn-primary btn-sm" @click="openNew">
        <AppIcon name="plus" :size="16" /> Новая категория
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <table v-if="list.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Название</th>
            <th class="th">Слаг</th>
            <th class="th">Порядок</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in list" :key="c.id" class="table-row">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ c.name }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ c.slug }}</td>
            <td class="td tabnum">{{ c.sortOrder ?? '—' }}</td>
            <td class="td text-right">
              <div class="flex justify-end gap-1">
                <button class="btn-ghost btn-sm" @click="openEdit(c)"><AppIcon name="edit" :size="14" /></button>
                <button class="btn-ghost btn-sm" @click="remove(c)"><AppIcon name="trash" :size="14" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="tag" title="Категорий пока нет" />
    </div>

    <ModalDialog v-if="modal" :title="form.id ? 'Категория' : 'Новая категория'" @close="modal = false">
      <div class="space-y-3">
        <div>
          <label class="label">Название</label>
          <input v-model="form.name" class="input" />
        </div>
        <div>
          <label class="label">Слаг</label>
          <input v-model="form.slug" class="input" placeholder="margarine" />
        </div>
        <div>
          <label class="label">Порядок сортировки</label>
          <input v-model="form.sortOrder" type="number" class="input" />
        </div>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving || !form.name.trim() || !form.slug.trim()" @click="save">
          Сохранить
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
