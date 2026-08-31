<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import CurrencyToggle from '@/components/CurrencyToggle.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Spinner from '@/components/Spinner.vue'
import Pagination from '@/components/Pagination.vue'
import { date, dualLabel, money, toISODate, userName } from '@/utils/format'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { idFromIri } from '@/api/iri'
import { api } from '@/api/client'
import { cashAccounts, expenses, expenseSummary } from '@/api/resources'

const auth = useAuthStore()
const confirmStore = useConfirmStore()

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')
const search = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({ docDate: toISODate(), description: '', amount: '', currency: 'UZS', account: '' })
const form = reactive(blank())

/**
 * Откуда взяты деньги. У продавца выбора нет — он тратит из своей смены, и бэкенд
 * находит её сам. Владелец счетами распоряжается, но своей смены обычно не имеет,
 * поэтому ему источник приходится называть.
 */
const accountList = ref([])
const canSpendFromAccount = computed(() => auth.can('wallet'))
const accountsInCurrency = computed(() => accountList.value.filter((a) => a.currency === form.currency))

// Валюта расхода и валюта счёта — одно и то же: доллары со счёта в сумах не платят.
watch(
  () => form.currency,
  () => {
    if (!accountsInCurrency.value.some((a) => `/api/cash_accounts/${a.id}` === form.account)) form.account = ''
  },
)

/** Плитка сверху — один агрегатный запрос (SUM на бэкенде), меняется вместе с периодом. */
const summary = ref({ totalUsd: '0', totalUzs: '0' })
const summaryLabel = computed(() => dualLabel(summary.value.totalUsd, summary.value.totalUzs))
async function loadSummary() {
  try {
    const params = {}
    if (from.value) params.from = from.value
    if (to.value) params.to = dayAfter(to.value)
    summary.value = await expenseSummary(params)
  } catch (e) {
    error.value = e.message
  }
}

/** Поиск уходит на бэкенд (?description=...) только от 2 символов и с задержкой. */
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
    const params = { page: p, itemsPerPage: pageSize, 'order[docDate]': 'desc' }
    if (searchQuery.value) params.description = searchQuery.value
    if (from.value) params['docDate[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['docDate[strictly_before]'] = dayAfter(to.value)
    const { items, totalItems: total } = await api.getPage('/expenses', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPage(1)
  loadSummary()
  if (canSpendFromAccount.value) {
    cashAccounts.list({ 'order[id]': 'asc' }).then(
      (list) => (accountList.value = list),
      () => {},
    )
  }
})

watch(searchQuery, () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))
watch([from, to], () => {
  page.value = 1
  loadPage(1)
  loadSummary()
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

function openNew() {
  Object.assign(form, blank())
  formError.value = ''
  modal.value = true
}

const valid = computed(() => form.description.trim() && Number(form.amount) > 0)

async function save() {
  if (!valid.value) return
  saving.value = true
  formError.value = ''
  try {
    await expenses.create({
      docDate: form.docDate,
      description: form.description.trim(),
      amount: String(form.amount),
      currency: form.currency,
      // Пустой счёт — расход из своей смены: бэкенд ждёт именно отсутствие поля.
      ...(form.account ? { account: form.account } : {}),
    })
    modal.value = false
    await Promise.all([loadPage(page.value), loadSummary()])
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

/** Источник расхода: счёт компании (по имени, если он подгружен) или смена автора. */
function sourceLabel(e) {
  if (e.account) {
    const id = String(idFromIri(e.account))
    return accountList.value.find((a) => String(a.id) === id)?.name ?? 'Счёт компании'
  }
  return e.cashSession ? 'Из смены' : '—'
}

async function remove(e) {
  if (!(await confirmStore.ask(`Удалить расход «${e.description}»?`))) return
  try {
    await expenses.remove(e.id)
    pageItems.value = pageItems.value.filter((x) => x.id !== e.id)
    totalItems.value -= 1
    await loadSummary()
  } catch (err) {
    error.value = err.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="card-pad w-full sm:max-w-xs">
      <div class="text-xs text-slate-500 dark:text-slate-400">Расходы за период</div>
      <div class="mt-1 tabnum text-lg font-semibold">{{ summaryLabel.primary }}</div>
      <div v-if="summaryLabel.secondary" class="tabnum text-xs text-slate-500 dark:text-slate-400">{{ summaryLabel.secondary }}</div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input w-full sm:max-w-xs" placeholder="Поиск по описанию" />
      <DateRangeFilter
        :month-label="monthLabel"
        :month-label-short="monthLabelShort"
        :specific-date="specificDate"
        @today="applyMonth(0)"
        @prev="shiftMonth(-1)"
        @next="shiftMonth(1)"
        @pick="applySpecificDate"
      />
      <button class="btn-primary btn-sm ml-auto" @click="openNew">
        <AppIcon name="plus" :size="16" /> Новый расход
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !pageItems.length" />
      <div v-if="pageItems.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="e in pageItems" :key="e.id" class="flex items-start justify-between gap-2 p-4">
          <div class="min-w-0">
            <div class="break-words font-medium text-slate-800 dark:text-slate-100">{{ e.description }}</div>
            <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {{ date(e.docDate) }} · {{ userName(e.createdBy) }} · {{ sourceLabel(e) }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="tabnum text-sm font-semibold text-red-600 dark:text-red-400">{{ money(e.amount, e.currency) }}</span>
            <button class="btn-ghost btn-sm" title="Удалить" @click="remove(e)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Дата</th>
            <th class="th">Описание</th>
            <th class="th">Сотрудник</th>
            <th class="th">Источник</th>
            <th class="th">Сумма</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in pageItems" :key="e.id" class="table-row">
            <td class="td text-slate-500 dark:text-slate-400">{{ date(e.docDate) }}</td>
            <td class="td text-slate-700 dark:text-slate-300">{{ e.description }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ userName(e.createdBy) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ sourceLabel(e) }}</td>
            <td class="td tabnum font-medium text-red-600 dark:text-red-400">{{ money(e.amount, e.currency) }}</td>
            <td class="td text-right">
              <button class="btn-ghost btn-sm" title="Удалить" @click="remove(e)">
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading && totalItems === 0" icon="trendDown" title="Расходов пока нет" />
      <EmptyState v-else-if="!loading" icon="trendDown" title="Ничего не найдено на этой странице" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>

    <ModalDialog v-if="modal" title="Новый расход" @close="modal = false" @submit="save">
      <div class="space-y-3">
        <div>
          <label class="label">Дата</label>
          <input v-model="form.docDate" type="date" class="input" />
        </div>
        <div>
          <label class="label">Описание</label>
          <textarea v-model="form.description" class="input" rows="3"></textarea>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class="label">Сумма</label>
            <input v-model="form.amount" type="number" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Валюта</label>
            <CurrencyToggle v-model="form.currency" />
          </div>
        </div>
        <div v-if="canSpendFromAccount">
          <label class="label">Откуда деньги</label>
          <select v-model="form.account" class="input">
            <option value="">Из моей смены</option>
            <option v-for="a in accountsInCurrency" :key="a.id" :value="`/api/cash_accounts/${a.id}`">
              {{ a.name }} · {{ money(a.balance, a.currency) }}
            </option>
          </select>
          <p class="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
            Со счёта компании платит владелец; продавец тратит из своей смены.
          </p>
        </div>

        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving || !valid" @click="save">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
