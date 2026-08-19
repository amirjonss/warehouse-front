<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Spinner from '@/components/Spinner.vue'
import Pagination from '@/components/Pagination.vue'
import { dateTime, money, rateFmt, rawPrice } from '@/utils/format'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'
import { batches, profitSummary } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')
const search = ref('')
const opened = ref(null)
const openedBatch = ref(null)

const TYPE = {
  realized: { label: 'Реализовано', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  reversed: { label: 'Отменено', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' },
}

/** Плитки сверху — один агрегатный запрос (SUM на бэкенде), меняется вместе с периодом. */
const summary = ref({ totalUsd: '0', totalUzs: '0' })
async function loadSummary() {
  try {
    const params = {}
    if (from.value) params.from = from.value
    if (to.value) params.to = dayAfter(to.value)
    summary.value = await profitSummary(params)
  } catch (e) {
    error.value = e.message
  }
}

/** Поиск уходит на бэкенд (?product.name=...) только от 2 символов и с задержкой. */
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
    const params = { page: p, itemsPerPage: pageSize, 'order[occurredAt]': 'desc' }
    if (searchQuery.value) params['product.name'] = searchQuery.value
    if (from.value) params['occurredAt[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['occurredAt[strictly_before]'] = dayAfter(to.value)
    const { items, totalItems: total } = await api.getPage('/profits', params)
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

/** batch на записи прибыли — голый IRI (нет группы profits:read у Batch), догружаем точечно при открытии. */
async function openProfit(p) {
  opened.value = p
  openedBatch.value = null
  try {
    openedBatch.value = await batches.get(idFromIri(p.batch))
  } catch {
    /* номер партии не критичен для просмотра */
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Прибыль, $</div>
        <div class="mt-1 tabnum text-lg font-semibold">{{ money(summary.totalUsd, 'USD') }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Прибыль, сум</div>
        <div class="mt-1 tabnum text-lg font-semibold">{{ money(summary.totalUzs, 'UZS') }}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input w-full sm:max-w-xs" placeholder="Поиск по товару" />
      <DateRangeFilter
        :month-label="monthLabel"
        :month-label-short="monthLabelShort"
        :specific-date="specificDate"
        @today="applyMonth(0)"
        @prev="shiftMonth(-1)"
        @next="shiftMonth(1)"
        @pick="applySpecificDate"
      />
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !pageItems.length" />
      <div v-if="pageItems.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="p in pageItems" :key="p.id" class="cursor-pointer p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50" @click="openProfit(p)">
          <div class="flex items-center justify-between gap-2">
            <span class="badge" :class="TYPE[p.type]?.cls">{{ TYPE[p.type]?.label ?? p.type }}</span>
            <span
              class="tabnum font-semibold"
              :class="Number(p.profit) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'"
            >
              {{ money(p.profit, p.currency) }}
            </span>
          </div>
          <div class="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{{ p.product?.name ?? '—' }}</div>
          <div class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{{ dateTime(p.occurredAt) }} · {{ p.sale?.number ?? '—' }}</div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Дата</th>
            <th class="th">Накладная</th>
            <th class="th">Товар</th>
            <th class="th">Тип</th>
            <th class="th">Прибыль</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pageItems" :key="p.id" class="table-row cursor-pointer" @click="openProfit(p)">
            <td class="td text-slate-500 dark:text-slate-400">{{ dateTime(p.occurredAt) }}</td>
            <td class="td text-slate-700 dark:text-slate-300">{{ p.sale?.number ?? '—' }}</td>
            <td class="td text-slate-700 dark:text-slate-300">{{ p.product?.name ?? '—' }}</td>
            <td class="td"><span class="badge" :class="TYPE[p.type]?.cls">{{ TYPE[p.type]?.label ?? p.type }}</span></td>
            <td class="td tabnum font-medium" :class="Number(p.profit) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">
              {{ money(p.profit, p.currency) }}
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading && totalItems === 0" icon="trendUp" title="Записей о прибыли пока нет" />
      <EmptyState v-else-if="!loading" icon="trendUp" title="Ничего не найдено на этой странице" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>

    <ModalDialog v-if="opened" title="Прибыль по позиции" :subtitle="dateTime(opened.occurredAt)" @close="opened = null">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Товар</span>
          <span class="font-medium text-slate-800 dark:text-slate-100">{{ opened.product?.name ?? '—' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Накладная</span>
          <span class="font-medium text-slate-800 dark:text-slate-100">{{ opened.sale?.number ?? '—' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Партия</span>
          <span class="font-medium text-slate-800 dark:text-slate-100">{{ openedBatch?.number ?? '—' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Кол-во</span>
          <span class="tabnum text-slate-700 dark:text-slate-300">{{ opened.saleItem?.quantity }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Цена</span>
          <span class="tabnum text-slate-700 dark:text-slate-300">{{ rawPrice(opened.saleItem?.price, opened.saleItem?.currency) }} {{ opened.saleItem?.currency }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Курс</span>
          <span class="tabnum text-slate-700 dark:text-slate-300">{{ rateFmt(opened.saleItem?.rate) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Сумма продажи</span>
          <span class="tabnum text-slate-700 dark:text-slate-300">{{ money(opened.saleItem?.total, opened.saleItem?.currency) }}</span>
        </div>
        <div class="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
          <span class="text-slate-500 dark:text-slate-400">Тип</span>
          <span class="badge" :class="TYPE[opened.type]?.cls">{{ TYPE[opened.type]?.label ?? opened.type }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-500 dark:text-slate-400">Прибыль</span>
          <span
            class="tabnum text-lg font-semibold"
            :class="Number(opened.profit) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'"
          >
            {{ money(opened.profit, opened.currency) }}
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
      </template>
    </ModalDialog>
  </div>
</template>
