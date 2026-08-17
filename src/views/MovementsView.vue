<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import Pagination from '@/components/Pagination.vue'
import Spinner from '@/components/Spinner.vue'
import { dateTime, qty } from '@/utils/format'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')
const search = ref('')
const type = ref('')

const TYPE = {
  in: { label: 'Приход', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  out: { label: 'Продажа', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400' },
  writeoff: { label: 'Списание', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
  adjust: { label: 'Корректировка', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' },
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
    if (type.value) params.type = type.value
    if (from.value) params['occurredAt[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['occurredAt[strictly_before]'] = dayAfter(to.value)
    const { items, totalItems: total } = await api.getPage('/stock_movements', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => loadPage(1))

watch([searchQuery, type], () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))
watch([from, to], () => {
  page.value = 1
  loadPage(1)
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input w-full sm:max-w-xs" placeholder="Поиск по товару" />
      <select v-model="type" class="input max-w-[160px]">
        <option value="">Все операции</option>
        <option value="in">Приход</option>
        <option value="out">Продажа</option>
        <option value="writeoff">Списание</option>
        <option value="adjust">Корректировка</option>
      </select>
      <DateRangeFilter
        :month-label="monthLabel"
        :month-label-short="monthLabelShort"
        :specific-date="specificDate"
        @today="applyMonth(0)"
        @prev="shiftMonth(-1)"
        @next="shiftMonth(1)"
        @pick="applySpecificDate"
      />
      <span class="ml-auto text-sm text-slate-500 dark:text-slate-400">Найдено: {{ totalItems }}</span>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !pageItems.length" />
      <div v-if="pageItems.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="m in pageItems" :key="m.id" class="p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="badge" :class="TYPE[m.type]?.cls">{{ TYPE[m.type]?.label ?? m.type }}</span>
            <span
              class="tabnum text-sm font-medium"
              :class="Number(m.quantity) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'"
            >
              {{ Number(m.quantity) > 0 ? '+' : '' }}{{ qty(m.quantity) }}
            </span>
          </div>
          <div class="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{{ m.product?.name ?? '—' }}</div>
          <div class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {{ dateTime(m.occurredAt) }} · {{ m.docNumber }} · {{ m.batch?.number ?? '—' }}
          </div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Дата и время</th>
            <th class="th">Операция</th>
            <th class="th">Документ</th>
            <th class="th">Товар</th>
            <th class="th">Партия</th>
            <th class="th">Кол-во</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in pageItems" :key="m.id" class="table-row">
            <td class="td text-slate-500 dark:text-slate-400">{{ dateTime(m.occurredAt) }}</td>
            <td class="td"><span class="badge" :class="TYPE[m.type]?.cls">{{ TYPE[m.type]?.label ?? m.type }}</span></td>
            <td class="td text-slate-600 dark:text-slate-400">{{ m.docNumber }}</td>
            <td class="td text-slate-700 dark:text-slate-300">{{ m.product?.name ?? '—' }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ m.batch?.number ?? '—' }}</td>
            <td class="td tabnum font-medium" :class="Number(m.quantity) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">
              {{ Number(m.quantity) > 0 ? '+' : '' }}{{ qty(m.quantity) }}
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="list" title="Движений не найдено" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>
  </div>
</template>
