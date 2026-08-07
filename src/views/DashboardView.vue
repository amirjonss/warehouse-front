<script setup>
import { computed, onMounted, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import SalesBarChart from '@/components/SalesBarChart.vue'
import StatCard from '@/components/StatCard.vue'
import { date, money, toISODate, addDays } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { clientDebt, clients, productStock, profits, sales } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const auth = useAuthStore()

const loading = ref(true)
const error = ref('')
const period = ref(14)

const allSales = ref([])
const allProfits = ref([])
const stockRows = ref([])
const clientList = ref([])
const debtList = ref([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const calls = [sales.list(), productStock(), clientDebt(), clients.list()]
    if (auth.can('profits')) calls.push(profits.list())
    const [s, stock, debt, c, p] = await Promise.all(calls)
    allSales.value = s
    stockRows.value = stock
    debtList.value = debt
    clientList.value = c
    allProfits.value = p ?? []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const today = toISODate()
const todaySales = computed(() => allSales.value.filter((s) => s.docDate === today && s.status === 'posted'))
const revenue = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const s of todaySales.value) {
    acc.USD += Number(s.totalUsd)
    acc.UZS += Number(s.totalUzs)
  }
  return acc
})
function dualLabel(usd, uzs) {
  const parts = []
  if (usd) parts.push(money(usd, 'USD'))
  if (uzs) parts.push(money(uzs, 'UZS'))
  return parts.join(' + ') || '0'
}
const revenueLabel = computed(() => dualLabel(revenue.value.USD, revenue.value.UZS))

const todayProfit = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const p of allProfits.value) {
    if (!p.occurredAt?.startsWith(today) || p.type !== 'realized') continue
    acc[p.currency] += Number(p.profit)
  }
  return acc
})
const profitLabel = computed(() => dualLabel(todayProfit.value.USD, todayProfit.value.UZS))

const totalDebt = computed(() => ({
  usd: debtList.value.reduce((s, d) => s + Number(d.debtUsd), 0),
  uzs: debtList.value.reduce((s, d) => s + Number(d.debtUzs), 0),
}))
const debtLabel = computed(() => dualLabel(totalDebt.value.usd, totalDebt.value.uzs))

const lowStock = computed(() => stockRows.value.filter((r) => Number(r.remainingQty) <= 0).slice(0, 6))

const chartData = computed(() => {
  const out = []
  for (let i = period.value - 1; i >= 0; i--) {
    const day = toISODate(addDays(new Date(), -i))
    const daySales = allSales.value.filter((s) => s.docDate === day && s.status === 'posted')
    out.push({
      date: day,
      total: daySales.reduce((s, x) => s + Number(x.totalUsd) + Number(x.totalUzs), 0),
      count: daySales.length,
    })
  }
  return out
})

const clientName = (v) => clientList.value.find((c) => String(c.id) === String(idFromIri(v)))?.name ?? '—'
const recentSales = computed(() =>
  [...allSales.value].filter((s) => s.status === 'posted').sort((a, b) => b.docDate.localeCompare(a.docDate)).slice(0, 6),
)
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
  <div v-else class="space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Выручка сегодня" :value="revenueLabel" :hint="`${todaySales.length} отгрузок`" icon="truck" tone="blue" to="/sales" />
      <StatCard v-if="auth.can('profits')" label="Прибыль сегодня" :value="profitLabel" icon="trendUp" tone="green" to="/profits" />
      <StatCard label="Долг клиентов" :value="debtLabel" icon="wallet" tone="amber" to="/debts" />
      <StatCard label="Позиций без остатка" :value="lowStock.length" icon="boxes" tone="red" to="/stock" />
    </div>

    <div class="card-pad">
      <div class="mb-3 flex items-center justify-between">
        <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Продажи по дням</div>
        <div class="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          <button
            v-for="d in [7, 14, 30]"
            :key="d"
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="period === d ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400'"
            @click="period = d"
          >
            {{ d }}д
          </button>
        </div>
      </div>
      <SalesBarChart :data="chartData" />
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="card-pad">
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Нет в наличии</div>
        <div v-if="lowStock.length" class="space-y-1.5">
          <RouterLink v-for="r in lowStock" :key="r.id" :to="`/products/${r.id}`" class="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <span class="text-slate-700 dark:text-slate-300">{{ r.name }}</span>
            <span class="tabnum text-red-600 dark:text-red-400">{{ r.remainingQty }}</span>
          </RouterLink>
        </div>
        <EmptyState v-else icon="check" title="Всё в наличии" />
      </div>

      <div class="card-pad">
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Последние отгрузки</div>
        <div v-if="recentSales.length" class="space-y-1.5">
          <RouterLink v-for="s in recentSales" :key="s.id" :to="`/sales?doc=${s.id}`" class="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <span class="min-w-0 truncate text-slate-700 dark:text-slate-300">{{ clientName(s.customer) }} · {{ s.number }}</span>
            <span class="tabnum shrink-0 text-slate-500 dark:text-slate-400">{{ date(s.docDate) }}</span>
          </RouterLink>
        </div>
        <EmptyState v-else icon="truck" title="Отгрузок пока нет" />
      </div>
    </div>
  </div>
</template>
