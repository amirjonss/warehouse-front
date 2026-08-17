<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import Pagination from '@/components/Pagination.vue'
import Spinner from '@/components/Spinner.vue'
import { daysLeft, money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'
import { clientDebtAging, clientDebtSummary } from '@/api/resources'

const auth = useAuthStore()

const loading = ref(true)
const error = ref('')
const search = ref('')

/** Три плитки сверху — один агрегатный запрос (SUM/COUNT на бэкенде), не сумма по всем клиентам на клиенте. */
const summary = ref({ count: 0, totalDebtUsd: '0', totalDebtUzs: '0' })
async function loadSummary() {
  try {
    summary.value = await clientDebtSummary()
  } catch (e) {
    error.value = e.message
  }
}

/**
 * Возраст долга — дата самой старой непогашенной накладной на клиента, отдельным
 * лёгким запросом (id -> дата). Мержим на клиенте, чтобы не трогать основной
 * список должников бэкендом ради одного дополнительного столбца.
 */
const aging = ref(new Map())
async function loadAging() {
  try {
    const { items } = await clientDebtAging()
    aging.value = new Map(items.map((i) => [i.clientId, i.oldestDebtDate]))
  } catch (e) {
    error.value = e.message
  }
}

function ageDays(clientId) {
  const d = aging.value.get(Number(clientId))
  if (!d) return null
  return Math.max(0, -daysLeft(d))
}

const BUCKETS = [
  { key: 'all', label: 'Все' },
  { key: '0-30', label: '0–30 дней' },
  { key: '31-60', label: '31–60 дней' },
  { key: '61-90', label: '61–90 дней' },
  { key: '90+', label: '90+ дней' },
]
function ageBucket(days) {
  if (days === null || days === undefined) return null
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}
const BUCKET_CLS = {
  '0-30': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  '31-60': 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  '61-90': 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
  '90+': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
}

/** Поиск уходит на бэкенд (?name=...) только от 2 символов и с задержкой. */
const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => {
  const s = debouncedSearch.value.trim()
  return s.length >= 2 ? s : ''
})

const page = ref(1)
const pageSize = 20

/** Обычный режим — сортировка по сумме долга, реальная пагинация на бэкенде. */
const pageItems = ref([])
const totalItems = ref(0)

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, hasDebt: true, 'order[debtUsd]': 'desc' }
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

/**
 * Сортировка «по давности» и фильтр по корзине требуют видеть всех должников
 * сразу — возраст не хранится в базе как отдельная колонка, сортировать им
 * постранично на бэкенде нечем. Для этого приложения (один склад, десятки
 * должников) загрузить их одним запросом дешевле, чем городить новый бэкенд-фильтр.
 */
const sortBy = ref('amount') // 'amount' | 'age'
const bucket = ref('all')
const usingFullMode = computed(() => sortBy.value === 'age' || bucket.value !== 'all')

const fullList = ref([])
async function loadFull() {
  loading.value = true
  error.value = ''
  try {
    const params = { page: 1, itemsPerPage: 200, hasDebt: true }
    if (searchQuery.value) params.name = searchQuery.value
    const { items } = await api.getPage('/clients', params)
    fullList.value = items
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  if (usingFullMode.value) loadFull()
  else loadPage(1)
}

const sortedFiltered = computed(() => {
  let arr = fullList.value.map((d) => ({ ...d, _age: ageDays(d.id) }))
  if (bucket.value !== 'all') arr = arr.filter((d) => ageBucket(d._age) === bucket.value)
  if (sortBy.value === 'age') arr = arr.slice().sort((a, b) => (b._age ?? -1) - (a._age ?? -1))
  return arr
})

const rows = computed(() => {
  if (!usingFullMode.value) return pageItems.value
  const start = (page.value - 1) * pageSize
  return sortedFiltered.value.slice(start, start + pageSize)
})
const rowsTotalItems = computed(() => (usingFullMode.value ? sortedFiltered.value.length : totalItems.value))
const rowsTotalPages = computed(() => Math.max(1, Math.ceil(rowsTotalItems.value / pageSize)))

onMounted(() => {
  loadPage(1)
  loadSummary()
  loadAging()
})

watch(searchQuery, reload)
watch([sortBy, bucket], reload)
watch(page, (p) => {
  if (!usingFullMode.value) loadPage(p)
})
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-3 gap-2 sm:gap-3">
      <div class="min-w-0 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
        <div class="text-xs text-slate-500 dark:text-slate-400">Должников</div>
        <div class="mt-1 text-base font-semibold sm:text-lg">{{ summary.count }}</div>
      </div>
      <div class="min-w-0 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, $</div>
        <div class="tabnum mt-1 text-base font-semibold break-words text-amber-600 sm:text-lg dark:text-amber-400">{{ money(summary.totalDebtUsd, 'USD') }}</div>
      </div>
      <div class="min-w-0 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, сум</div>
        <div class="tabnum mt-1 text-base font-semibold break-words text-amber-600 sm:text-lg dark:text-amber-400">{{ money(summary.totalDebtUzs, 'UZS') }}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input w-full sm:w-auto sm:max-w-xs" placeholder="Поиск по клиенту" />
      <select v-model="sortBy" class="input w-auto">
        <option value="amount">По сумме долга</option>
        <option value="age">По давности</option>
      </select>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="b in BUCKETS"
          :key="b.key"
          type="button"
          class="rounded-full px-2.5 py-1 text-xs font-medium transition"
          :class="bucket === b.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'"
          @click="bucket = b.key"
        >
          {{ b.label }}
        </button>
      </div>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !rows.length" />

      <div v-if="rows.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="d in rows" :key="d.id" class="flex items-center justify-between gap-2 p-4">
          <div class="min-w-0">
            <RouterLink :to="`/clients/${d.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">
              {{ d.name }}
            </RouterLink>
            <div class="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <span v-if="d.phone">{{ d.phone }}</span>
              <span v-if="ageDays(d.id) !== null" class="badge" :class="BUCKET_CLS[ageBucket(ageDays(d.id))]">{{ ageDays(d.id) }} дн.</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <div class="tabnum text-right text-sm">
              <div v-if="Number(d.debtUsd) > 0" class="text-amber-600 dark:text-amber-400">{{ money(d.debtUsd, 'USD') }}</div>
              <div v-if="Number(d.debtUzs) > 0" class="text-amber-600 dark:text-amber-400">{{ money(d.debtUzs, 'UZS') }}</div>
            </div>
            <RouterLink v-if="auth.can('payments.create')" :to="`/clients/${d.id}/payment/new`" class="btn-ghost btn-sm">Оплата</RouterLink>
          </div>
        </div>
      </div>

      <table v-if="rows.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Клиент</th>
            <th class="th">Телефон</th>
            <th class="th">Долг, $</th>
            <th class="th">Долг, сум</th>
            <th class="th">Возраст</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in rows" :key="d.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/clients/${d.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">{{ d.name }}</RouterLink>
            </td>
            <td class="td text-slate-500 dark:text-slate-400">
              <a v-if="d.phone" :href="`tel:${d.phone}`" class="hover:text-indigo-600">{{ d.phone }}</a>
              <span v-else class="text-slate-300 dark:text-slate-600">—</span>
            </td>
            <td class="td tabnum" :class="Number(d.debtUsd) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'">
              {{ Number(d.debtUsd) > 0 ? money(d.debtUsd, 'USD') : '—' }}
            </td>
            <td class="td tabnum" :class="Number(d.debtUzs) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'">
              {{ Number(d.debtUzs) > 0 ? money(d.debtUzs, 'UZS') : '—' }}
            </td>
            <td class="td">
              <span v-if="ageDays(d.id) !== null" class="badge" :class="BUCKET_CLS[ageBucket(ageDays(d.id))]">{{ ageDays(d.id) }} дн.</span>
              <span v-else class="text-slate-300 dark:text-slate-600">—</span>
            </td>
            <td class="td text-right">
              <RouterLink v-if="auth.can('payments.create')" :to="`/clients/${d.id}/payment/new`" class="btn-ghost btn-sm">
                Оплата
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading && rowsTotalItems === 0" icon="wallet" title="Должников нет" text="Все клиенты рассчитались" />
      <EmptyState v-else-if="!loading" icon="wallet" title="Ничего не найдено на этой странице" />

      <Pagination :page="page" :total-pages="rowsTotalPages" :total-items="rowsTotalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>
  </div>
</template>
