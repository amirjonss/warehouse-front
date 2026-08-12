<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import Pagination from '@/components/Pagination.vue'
import { qty, rawPrice, stockStatus, unitLabel, date } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'
import { productStockSummary } from '@/api/resources'

const route = useRoute()
const auth = useAuthStore()

const tab = ref(route.query.tab === 'batches' ? 'batches' : 'products')
const search = ref('')
const onlyLow = ref(false)

const summary = ref({ positions: 0, low: 0 })
const loading = ref(true)
const error = ref('')

const page = ref(1)
const pageSize = 20

/**
 * Поиск уходит на бэкенд (?name=...) только от 2 символов и с задержкой —
 * не гонять запрос на каждое нажатие клавиши.
 */
const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => {
  const s = debouncedSearch.value.trim()
  return s.length >= 2 ? s : ''
})

/**
 * «По товарам» — реальная серверная пагинация/фильтрация: поиск уходит как ?name=,
 * «только на исходе» — как ?lowStock=true (remainingQty <= minStock, считается в SQL
 * через LowStockFilter). Ничего не догружается на клиент целиком.
 */
const pageItems = ref([])
const totalItems = ref(0)

const withMinStock = (p) => ({ ...p, minStock: Number(p.minStock) })

async function loadProductsPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize }
    if (searchQuery.value) params.name = searchQuery.value
    if (onlyLow.value) params.lowStock = 'true'
    const { items, totalItems: total } = await api.getPage('/products', params)
    pageItems.value = items.map(withMinStock)
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

/**
 * Бэкенд уже отдаёт в каждой партии вложенные product.name и supplier.name —
 * отдельные запросы за товарами/поставщиками для подписи партий не нужны.
 */
const withBatchDerived = (b) => ({
  ...b,
  stock: Number(b.remainingQty),
  productName: b.product?.name ?? '—',
  supplierName: b.supplier?.name ?? '—',
})

/** «По партиям» — тоже реальный серверный поиск, только фильтр по вложенному полю product.name. */
const batchesPage = ref(1)
const pageBatches = ref([])
const totalBatchItems = ref(0)

async function loadBatchesPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, 'order[receivedAt]': 'asc' }
    if (searchQuery.value) params['product.name'] = searchQuery.value
    const { items, totalItems: total } = await api.getPage('/batches', params)
    pageBatches.value = items.map(withBatchDerived).filter((b) => b.stock > 0)
    totalBatchItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    summary.value = await productStockSummary()
  } catch (e) {
    error.value = e.message
  }
  if (tab.value === 'batches' && auth.can('batches')) await loadBatchesPage(1)
  else await loadProductsPage(1)
})

watch(tab, (newTab) => {
  if (newTab === 'batches' && auth.can('batches')) loadBatchesPage(batchesPage.value)
  else if (newTab === 'products') loadProductsPage(page.value)
})

/** Реальный запрос на бэкенд — только когда поиск «созрел» (2+ символа, с задержкой). */
watch(searchQuery, () => {
  if (tab.value === 'products') {
    page.value = 1
    loadProductsPage(1)
  }
  if (tab.value === 'batches') {
    batchesPage.value = 1
    loadBatchesPage(1)
  }
})

watch(onlyLow, () => {
  if (tab.value !== 'products') return
  page.value = 1
  loadProductsPage(1)
})

watch(page, (p) => {
  if (tab.value === 'products') loadProductsPage(p)
})

watch(batchesPage, (p) => {
  if (tab.value === 'batches') loadBatchesPage(p)
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))
const pagedProducts = computed(() => pageItems.value)

const batchesTotalPages = computed(() => Math.max(1, Math.ceil(totalBatchItems.value / pageSize)))
const pagedBatches = computed(() => pageBatches.value)

const totals = computed(() => summary.value)
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-3">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Позиций в наличии</div>
        <div class="mt-1 text-lg font-semibold">{{ totals.positions }}</div>
      </div>
      <div class="card-pad cursor-pointer" @click="tab = 'products'; onlyLow = true">
        <div class="text-xs text-slate-500 dark:text-slate-400">На исходе</div>
        <div class="mt-1 text-lg font-semibold" :class="totals.low ? 'text-amber-600 dark:text-amber-400' : ''">{{ totals.low }}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
        <button class="rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'products' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'products'">
          По товарам
        </button>
        <button v-if="auth.can('batches')" class="rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'batches' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'batches'">
          По партиям
        </button>
      </div>
      <label v-if="tab === 'products'" class="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
        <input v-model="onlyLow" type="checkbox" class="h-4 w-4 rounded border-slate-300 bg-white text-indigo-600 dark:border-slate-700 dark:bg-slate-800" /> Только на исходе
      </label>
      <input v-model="search" class="input w-full sm:w-auto sm:max-w-xs" placeholder="Поиск" />
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div v-if="tab === 'products'" class="card overflow-hidden">
      <div v-if="pagedProducts.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <RouterLink v-for="r in pagedProducts" :key="r.id" :to="`/products/${r.id}`" class="flex items-center justify-between gap-2 p-4">
          <div class="min-w-0">
            <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ r.name }}</div>
            <div class="text-xs text-slate-400 dark:text-slate-500">{{ r.sku }}</div>
          </div>
          <div class="shrink-0 text-right">
            <div class="tabnum text-sm text-slate-700 dark:text-slate-300">{{ qty(r.remainingQty) }} {{ unitLabel(r.unit) }}</div>
            <span class="badge mt-1" :class="stockStatus(Number(r.remainingQty), r.minStock).cls">
              {{ stockStatus(Number(r.remainingQty), r.minStock).label }}
            </span>
          </div>
        </RouterLink>
      </div>

      <table v-if="pagedProducts.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Товар</th>
            <th class="th">Остаток</th>
            <th class="th">Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in pagedProducts" :key="r.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/products/${r.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">{{ r.name }}</RouterLink>
              <div class="text-xs text-slate-400 dark:text-slate-500">{{ r.sku }}</div>
            </td>
            <td class="td tabnum">{{ qty(r.remainingQty) }} {{ unitLabel(r.unit) }}</td>
            <td class="td">
              <span class="badge" :class="stockStatus(Number(r.remainingQty), r.minStock).cls">
                {{ stockStatus(Number(r.remainingQty), r.minStock).label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="boxes" title="Ничего не найдено" />

      <Pagination
        :page="page"
        :total-pages="totalPages"
        :total-items="totalItems"
        :page-size="pageSize"
        @update:page="page = $event"
      />
    </div>

    <div v-else class="card overflow-hidden">
      <div v-if="pagedBatches.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div v-for="b in pagedBatches" :key="b.id" class="p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-slate-800 dark:text-slate-100">{{ b.number }}</span>
            <span class="tabnum text-sm text-slate-700 dark:text-slate-300">{{ qty(b.stock) }}</span>
          </div>
          <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ b.productName }} · {{ date(b.receivedAt) }}</div>
          <div class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {{ b.supplierName }}
            <template v-if="auth.can('prices.purchase')"> · {{ rawPrice(b.purchasePrice, b.currency) }} {{ b.currency }}</template>
          </div>
        </div>
      </div>

      <table v-if="pagedBatches.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Партия</th>
            <th class="th">Товар</th>
            <th class="th">Принято</th>
            <th class="th">Осталось</th>
            <th v-if="auth.can('prices.purchase')" class="th">Себестоимость</th>
            <th class="th">Поставщик</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in pagedBatches" :key="b.id" class="table-row">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ b.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ b.productName }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(b.receivedAt) }}</td>
            <td class="td tabnum">{{ qty(b.stock) }}</td>
            <td v-if="auth.can('prices.purchase')" class="td tabnum">{{ rawPrice(b.purchasePrice, b.currency) }} {{ b.currency }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ b.supplierName }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="layers" title="Партий с остатком нет" />

      <Pagination
        :page="batchesPage"
        :total-pages="batchesTotalPages"
        :total-items="totalBatchItems"
        :page-size="pageSize"
        @update:page="batchesPage = $event"
      />
    </div>
  </div>
</template>
