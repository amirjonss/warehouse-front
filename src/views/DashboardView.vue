<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import SalesBarChart from '@/components/SalesBarChart.vue'
import StatCard from '@/components/StatCard.vue'
import { date, dualLabel, money, pluralRu, toISODate, addDays } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import { cashOnHands, clientDebtSummary, expenseDaily, expenseSummary, productStockSummary, productTopSales, sales } from '@/api/resources'

const auth = useAuthStore()

const loading = ref(true)
const error = ref('')
const salesPeriod = ref(14)
const expensesPeriod = ref(14)

const today = toISODate()
const tomorrow = toISODate(addDays(new Date(), 1))

/** Продажи только за выбранный период (7/14/30 дней) — не вся история продаж. */
const periodSales = ref([])
/** Расходы по дням — сразу агрегированы бэкендом (один запрос вместо постраничного). */
const expenseDailyRows = ref([])
const recentSales = ref([])
const outOfStockList = ref([])
const stockSummary = ref({ positions: 0, low: 0, outOfStock: 0 })
const debtSummary = ref({ count: 0, totalDebtUsd: '0', totalDebtUzs: '0' })
const expenseToday = ref({ totalUsd: '0', totalUzs: '0' })
const onHands = ref({ balanceUsd: '0', balanceUzs: '0', unconfirmedUsd: '0', unconfirmedUzs: '0', openSessions: 0 })
const topProducts = ref([])

async function loadSalesPeriod() {
  const start = toISODate(addDays(new Date(), -(salesPeriod.value - 1)))
  const range = { 'docDate[after]': start, 'docDate[before]': today, 'order[docDate]': 'desc' }
  await Promise.all([
    sales.list(range).then((s) => (periodSales.value = s)),
    productTopSales({ from: start, to: tomorrow, limit: 6 }).then((r) => (topProducts.value = r.items)),
  ])
}

async function loadExpensesPeriod() {
  if (!auth.can('expenses')) return
  const start = toISODate(addDays(new Date(), -(expensesPeriod.value - 1)))
  const r = await expenseDaily({ from: start, to: tomorrow })
  expenseDailyRows.value = r.items
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const calls = [
      loadSalesPeriod(),
      loadExpensesPeriod(),
      // Sale не фильтруется по status на бэкенде — берём с запасом и оставляем только проведённые.
      api.getPage('/sales', { page: 1, itemsPerPage: 15, 'order[docDate]': 'desc', 'order[id]': 'desc' }).then(({ items }) => {
        recentSales.value = items.filter((s) => s.status === 'posted').slice(0, 6)
      }),
      // itemsPerPage не имеет эффекта без pagination_client_items_per_page на бэкенде — обрезаем на клиенте.
      api.getPage('/products', { page: 1, itemsPerPage: 6, 'remainingQty[lte]': 0 }).then(({ items }) => {
        outOfStockList.value = items.slice(0, 6)
      }),
      productStockSummary().then((s) => (stockSummary.value = s)),
      clientDebtSummary().then((s) => (debtSummary.value = s)),
    ]
    if (auth.can('expenses')) {
      calls.push(expenseSummary({ from: today, to: tomorrow }).then((s) => (expenseToday.value = s)))
    }
    if (auth.can('cash.admin')) {
      calls.push(cashOnHands().then((s) => (onHands.value = s)))
    }
    await Promise.all(calls)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

watch(salesPeriod, () => loadSalesPeriod())
watch(expensesPeriod, () => loadExpensesPeriod())

/** docDate приходит полной ISO-датой ("2026-08-08T00:00:00+00:00") — сравниваем только дату. */
const saleDay = (s) => s.docDate.slice(0, 10)
const todaySales = computed(() => periodSales.value.filter((s) => saleDay(s) === today && s.status === 'posted'))
const revenue = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const s of todaySales.value) {
    acc.USD += Number(s.totalUsd)
    acc.UZS += Number(s.totalUzs)
  }
  return acc
})
const revenueLabel = computed(() => dualLabel(revenue.value.USD, revenue.value.UZS))
const debtLabel = computed(() => dualLabel(Number(debtSummary.value.totalDebtUsd), Number(debtSummary.value.totalDebtUzs)))
const expenseLabel = computed(() => dualLabel(expenseToday.value.totalUsd, expenseToday.value.totalUzs))
const openSessionsHint = computed(
  () => `${onHands.value.openSessions} ${pluralRu(onHands.value.openSessions, ['открытая смена', 'открытые смены', 'открытых смен'])}`,
)
/** Долг продавцов = наличные в сумке плюс отданное, но не подтверждённое владельцем. */
const onHandsLabel = computed(() =>
  dualLabel(
    Number(onHands.value.balanceUsd) + Number(onHands.value.unconfirmedUsd),
    Number(onHands.value.balanceUzs) + Number(onHands.value.unconfirmedUzs),
  ),
)

const chartData = computed(() => {
  const out = []
  for (let i = salesPeriod.value - 1; i >= 0; i--) {
    const day = toISODate(addDays(new Date(), -i))
    const daySales = periodSales.value.filter((s) => saleDay(s) === day && s.status === 'posted')
    out.push({
      date: day,
      // Высота столбца и ось — в сумах (валюта отчётности), доллары не складываем с ними как одно число.
      total: daySales.reduce((s, x) => s + Number(x.totalUzs), 0),
      totalUsd: daySales.reduce((s, x) => s + Number(x.totalUsd), 0),
      count: daySales.length,
    })
  }
  return out
})

const expenseChartData = computed(() => {
  const byDay = new Map(expenseDailyRows.value.map((r) => [r.date, r]))
  const out = []
  for (let i = expensesPeriod.value - 1; i >= 0; i--) {
    const day = toISODate(addDays(new Date(), -i))
    const row = byDay.get(day)
    // Столбик рисуем по сумовой части: сложить с долларовой без курса нельзя,
    // а курс дня на графике за две недели был бы враньём.
    out.push({ date: day, total: row ? Number(row.totalUzs) : 0, count: row?.count ?? 0 })
  }
  return out
})
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
  <div v-else class="space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Выручка сегодня"
        :value="revenueLabel.primary"
        :sub-value="revenueLabel.secondary"
        :hint="`${todaySales.length} продаж`"
        icon="cart"
        tone="blue"
        to="/sales"
      />
      <StatCard
        v-if="auth.can('expenses')"
        label="Расход сегодня"
        :value="expenseLabel.primary"
        :sub-value="expenseLabel.secondary"
        icon="trendDown"
        tone="red"
        to="/expenses"
      />
      <StatCard label="Долг клиентов" :value="debtLabel.primary" :sub-value="debtLabel.secondary" icon="wallet" tone="amber" to="/debts" />
      <StatCard
        v-if="auth.can('cash.admin')"
        label="На руках у продавцов"
        :value="onHandsLabel.primary"
        :sub-value="onHandsLabel.secondary"
        :hint="openSessionsHint"
        icon="money"
        tone="slate"
        to="/cash-sessions"
      />
      <StatCard label="Позиций без остатка" :value="stockSummary.outOfStock" icon="boxes" tone="red" to="/stock" />
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="card-pad">
        <div class="mb-3 flex items-center justify-between">
          <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Продажи по дням</div>
          <div class="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            <button
              v-for="d in [7, 14, 30]"
              :key="d"
              class="rounded-md px-2.5 py-1 text-xs font-medium"
              :class="salesPeriod === d ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400'"
              @click="salesPeriod = d"
            >
              {{ d }}д
            </button>
          </div>
        </div>
        <SalesBarChart :data="chartData" :height="110" />
      </div>

      <div v-if="auth.can('expenses')" class="card-pad">
        <div class="mb-3 flex items-center justify-between">
          <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Расходы по дням</div>
          <div class="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            <button
              v-for="d in [7, 14, 30]"
              :key="d"
              class="rounded-md px-2.5 py-1 text-xs font-medium"
              :class="expensesPeriod === d ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400'"
              @click="expensesPeriod = d"
            >
              {{ d }}д
            </button>
          </div>
        </div>
        <SalesBarChart :data="expenseChartData" :height="110" tone="red" count-label="расходов" />
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="card-pad">
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Нет в наличии</div>
        <div v-if="outOfStockList.length" class="space-y-1.5">
          <RouterLink v-for="r in outOfStockList" :key="r.id" :to="`/products/${r.id}`" class="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <span class="text-slate-700 dark:text-slate-300">{{ r.name }}</span>
            <span class="tabnum text-red-600 dark:text-red-400">{{ r.remainingQty }}</span>
          </RouterLink>
        </div>
        <EmptyState v-else icon="check" title="Всё в наличии" />
      </div>

      <div class="card-pad">
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Последние продажи</div>
        <div v-if="recentSales.length" class="space-y-1.5">
          <RouterLink v-for="s in recentSales" :key="s.id" :to="`/sales?doc=${s.id}`" class="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <span class="min-w-0 truncate text-slate-700 dark:text-slate-300">{{ s.customer?.name ?? '—' }} · {{ s.number }}</span>
            <span class="tabnum shrink-0 text-slate-500 dark:text-slate-400">{{ date(s.docDate) }}</span>
          </RouterLink>
        </div>
        <EmptyState v-else icon="cart" title="Продаж пока нет" />
      </div>

      <div class="card-pad">
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Топ товаров за {{ salesPeriod }}д</div>
        <div v-if="topProducts.length" class="space-y-1.5">
          <RouterLink v-for="p in topProducts" :key="p.productId" :to="`/products/${p.productId}`" class="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <span class="min-w-0 truncate text-slate-700 dark:text-slate-300">{{ p.productName }}</span>
            <span class="tabnum shrink-0 text-slate-500 dark:text-slate-400">{{ p.quantity }}</span>
          </RouterLink>
        </div>
        <EmptyState v-else icon="tag" title="Продаж пока нет" />
      </div>
    </div>
  </div>
</template>
