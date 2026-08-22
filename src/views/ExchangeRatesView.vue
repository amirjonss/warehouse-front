<script setup>
import { onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Spinner from '@/components/Spinner.vue'
import { dateTime, userName } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { useExchangeRateStore } from '@/stores/exchangeRate'
import { exchangeRates } from '@/api/resources'

const auth = useAuthStore()
const confirmStore = useConfirmStore()
const rateStore = useExchangeRateStore()

const list = ref([])
const loading = ref(true)
const error = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

/** Даты своей у курса больше нет — она проставляется на бэкенде автоматически (createdAt). */
const blank = () => ({ isNew: true, id: null, createdAt: null, rateBuy: '', rateSell: '' })
const form = reactive(blank())

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await exchangeRates.list({ 'order[createdAt]': 'desc' })
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
function openEdit(r) {
  Object.assign(form, { isNew: false, id: r.id, createdAt: r.createdAt, rateBuy: r.rateBuy, rateSell: r.rateSell })
  formError.value = ''
  modal.value = true
}

async function save() {
  if (!form.rateBuy || !form.rateSell) return
  saving.value = true
  formError.value = ''
  try {
    if (form.isNew) {
      await exchangeRates.create({
        rateBuy: Number(form.rateBuy),
        rateSell: Number(form.rateSell),
      })
    } else {
      await exchangeRates.update(form.id, {
        rateBuy: Number(form.rateBuy),
        rateSell: Number(form.rateSell),
      })
    }
    modal.value = false
    await Promise.all([load(), rateStore.refresh()])
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(r) {
  if (!(await confirmStore.ask(`Удалить курс от ${dateTime(r.createdAt)}?`))) return
  try {
    await exchangeRates.remove(r.id)
    await Promise.all([load(), rateStore.refresh()])
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
      Курс здесь — справочный, для ориентира. Он никуда не подставляется автоматически: при
      продаже и оплате курс вводится вручную на каждой строке/платеже.
    </p>

    <div class="flex items-center justify-between">
      <div class="text-sm text-slate-500 dark:text-slate-400">Записей: {{ list.length }}</div>
      <button v-if="auth.can('exchangeRates')" class="btn-primary btn-sm" @click="openNew">
        <AppIcon name="plus" :size="16" /> Добавить курс
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !list.length" />
      <div v-if="list.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="r in list" :key="r.id" class="flex items-center justify-between gap-2 p-4">
          <div>
            <div class="font-medium text-slate-800 dark:text-slate-100">{{ dateTime(r.createdAt) }}</div>
            <div class="mt-0.5 tabnum text-xs text-slate-500 dark:text-slate-400">
              {{ Number(r.rateBuy).toLocaleString('ru-RU') }} / {{ Number(r.rateSell).toLocaleString('ru-RU') }}
            </div>
            <div class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{{ userName(r.createdBy) }}</div>
          </div>
          <div class="flex shrink-0 gap-1">
            <button class="btn-ghost btn-sm" @click="openEdit(r)"><AppIcon name="edit" :size="14" /></button>
            <button class="btn-ghost btn-sm" @click="remove(r)"><AppIcon name="trash" :size="14" /></button>
          </div>
        </div>
      </div>

      <table v-if="list.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Дата</th>
            <th class="th">Покупка</th>
            <th class="th">Продажа</th>
            <th class="th">Кто</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in list" :key="r.id" class="table-row">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ dateTime(r.createdAt) }}</td>
            <td class="td tabnum">{{ Number(r.rateBuy).toLocaleString('ru-RU') }}</td>
            <td class="td tabnum">{{ Number(r.rateSell).toLocaleString('ru-RU') }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ userName(r.createdBy) }}</td>
            <td class="td text-right">
              <div class="flex justify-end gap-1">
                <button class="btn-ghost btn-sm" @click="openEdit(r)"><AppIcon name="edit" :size="14" /></button>
                <button class="btn-ghost btn-sm" @click="remove(r)"><AppIcon name="trash" :size="14" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="money" title="Курсов пока нет" />
    </div>

    <ModalDialog v-if="modal" :title="form.isNew ? 'Новый курс' : 'Курс от ' + dateTime(form.createdAt)" @close="modal = false" @submit="save">
      <div class="space-y-3">
        <div>
          <label class="label">Курс покупки</label>
          <input v-model="form.rateBuy" type="number" step="1" class="input" />
        </div>
        <div>
          <label class="label">Курс продажи</label>
          <input v-model="form.rateSell" type="number" step="1" class="input" />
        </div>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving" @click="save">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
