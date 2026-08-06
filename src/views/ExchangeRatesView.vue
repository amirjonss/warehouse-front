<script setup>
import { onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date, toISODate } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { exchangeRates } from '@/api/resources'

const auth = useAuthStore()

const list = ref([])
const loading = ref(true)
const error = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({ isNew: true, rateDate: toISODate(), rateBuy: '', rateSell: '' })
const form = reactive(blank())

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await exchangeRates.list({ 'order[rateDate]': 'desc' })
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
  Object.assign(form, { isNew: false, rateDate: r.rateDate, rateBuy: r.rateBuy, rateSell: r.rateSell })
  formError.value = ''
  modal.value = true
}

async function save() {
  if (!form.rateDate || !form.rateBuy || !form.rateSell) return
  saving.value = true
  formError.value = ''
  try {
    if (form.isNew) {
      await exchangeRates.create({
        rateDate: form.rateDate,
        rateBuy: String(form.rateBuy),
        rateSell: String(form.rateSell),
      })
    } else {
      await exchangeRates.update(form.rateDate, {
        rateBuy: String(form.rateBuy),
        rateSell: String(form.rateSell),
      })
    }
    modal.value = false
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(r) {
  if (!confirm(`Удалить курс на ${date(r.rateDate)}?`)) return
  try {
    await exchangeRates.remove(r.rateDate)
    await load()
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
      Курс здесь — справочный, для ориентира. Он никуда не подставляется автоматически: при
      продаже и оплате курс вводится вручную на каждой строке/платеже.
    </p>

    <div class="flex items-center justify-between">
      <div class="text-sm text-slate-500">Записей: {{ list.length }}</div>
      <button v-if="auth.can('exchangeRates')" class="btn-primary btn-sm" @click="openNew">
        <AppIcon name="plus" :size="16" /> Добавить курс
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div class="card overflow-hidden">
      <table v-if="list.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Дата</th>
            <th class="th">Покупка</th>
            <th class="th">Продажа</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in list" :key="r.rateDate" class="table-row">
            <td class="td font-medium text-slate-800">{{ date(r.rateDate) }}</td>
            <td class="td tabnum">{{ Number(r.rateBuy).toLocaleString('ru-RU') }}</td>
            <td class="td tabnum">{{ Number(r.rateSell).toLocaleString('ru-RU') }}</td>
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

    <ModalDialog v-if="modal" :title="form.isNew ? 'Новый курс' : 'Курс на ' + date(form.rateDate)" @close="modal = false">
      <div class="space-y-3">
        <div v-if="form.isNew">
          <label class="label">Дата</label>
          <input v-model="form.rateDate" type="date" class="input" />
        </div>
        <div>
          <label class="label">Курс покупки</label>
          <input v-model="form.rateBuy" type="number" step="0.0001" class="input" />
        </div>
        <div>
          <label class="label">Курс продажи</label>
          <input v-model="form.rateSell" type="number" step="0.0001" class="input" />
        </div>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving" @click="save">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
