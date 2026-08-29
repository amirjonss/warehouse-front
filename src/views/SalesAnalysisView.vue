<script setup>
/**
 * Анализ продаж по периодам: как шла торговля день за днём (или неделя, месяц).
 *
 * Смысл отчёта — выручка и маржа рядом: оборот может расти, а деньги на нём —
 * падать, и видно это только в паре. Себестоимость приходит по партиям, из
 * которых товар ушёл, поэтому отчёт доступен только владельцу.
 *
 * Считает всё бэкенд (POST /sales/analysis), здесь только показ.
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CurrencyToggle from '@/components/CurrencyToggle.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import StatCard from '@/components/StatCard.vue'
import { date, money, moneyShort, pluralRu, qty } from '@/utils/format'
import { dayAfter } from '@/composables/useDateRangeFilter'
import { categories, salesAnalysis } from '@/api/resources'

const loading = ref(true)
const error = ref('')

const INTERVALS = [
  { value: 'day', label: 'По дням' },
  { value: 'week', label: 'По неделям' },
  { value: 'month', label: 'По месяцам' },
]
const interval = ref('day')
// Валюта обязательна: каждая колонка здесь — деньги, а доллары с сумами не складываются.
const currency = ref('USD')
const category = ref('')

/**
 * Период подчинён разрезу, а не живёт отдельно: месяц, нарезанный по месяцам, дал
 * бы одну строку, а год, нарезанный по дням, — три с половиной сотни. Поэтому
 * стрелки шагают тем же шагом, в котором отчёт и читают: дни смотрят за месяц,
 * недели — за квартал, месяцы — за год.
 */
const UNIT = { day: 'month', week: 'quarter', month: 'year' }

const anchor = ref(new Date()) // любая дата внутри выбранного периода

const unit = computed(() => UNIT[interval.value])

const range = computed(() => {
  const d = anchor.value
  const y = d.getFullYear()
  if (unit.value === 'month') return [new Date(y, d.getMonth(), 1), new Date(y, d.getMonth() + 1, 0)]
  if (unit.value === 'quarter') {
    const q = Math.floor(d.getMonth() / 3)
    return [new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0)]
  }
  return [new Date(y, 0, 1), new Date(y, 11, 31)]
})

/** Локальная YYYY-MM-DD без сдвига по UTC (в отличие от toISOString). */
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const from = computed(() => localISO(range.value[0]))
const to = computed(() => localISO(range.value[1]))

const ROMAN = ['I', 'II', 'III', 'IV']
const capitalize = (v) => v.charAt(0).toUpperCase() + v.slice(1)
const monthName = (d, opts) => capitalize(d.toLocaleDateString('ru-RU', { month: opts, year: 'numeric' }))

const periodLabelLong = computed(() => {
  const d = anchor.value
  if (unit.value === 'month') return monthName(d, 'long')
  if (unit.value === 'quarter') return `${ROMAN[Math.floor(d.getMonth() / 3)]} квартал ${d.getFullYear()}`
  return `${d.getFullYear()} год`
})
const periodLabelShort = computed(() => {
  const d = anchor.value
  if (unit.value === 'month') return monthName(d, 'short').replace('.', '')
  if (unit.value === 'quarter') return `${ROMAN[Math.floor(d.getMonth() / 3)]} кв. ${d.getFullYear()}`
  return String(d.getFullYear())
})

function shiftPeriod(delta) {
  const d = new Date(anchor.value)
  if (unit.value === 'month') d.setMonth(d.getMonth() + delta)
  else if (unit.value === 'quarter') d.setMonth(d.getMonth() + delta * 3)
  else d.setFullYear(d.getFullYear() + delta)
  anchor.value = d
}

const goToday = () => (anchor.value = new Date())

/** Вперёд дальше текущего периода не пускаем: продаж из будущего не бывает. */
const atCurrentPeriod = computed(() => range.value[1] >= new Date())

const categoryList = ref([])

const blank = () => ({ period: null, documents: 0, quantity: '0', revenue: '0', cost: '0', profit: '0', margin: '0' })
const report = ref({ interval: 'day', baseCurrency: 'USD', rows: [], total: blank() })

const cur = computed(() => report.value.baseCurrency ?? 'USD')
const sum = (v) => money(v, cur.value)

/** Ноль по выручке — это не «нет данных», а честный ноль, поэтому строку не прячем. */
const marginTone = (v) =>
  Number(v) < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'

const percent = (v) => `${Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`

/**
 * Неделя приходит от date_trunc — её понедельник может лежать до начала периода.
 * Поэтому подписываем реально покрытый отрезок, обрезанный границами периода:
 * «с 01.06» вместо «с 25.05», в которой данных за май всё равно нет.
 */
function weekLabel(period) {
  const [lo, hi] = range.value
  const start = new Date(period)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const dm = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return `${dm(start < lo ? lo : start)} — ${dm(end > hi ? hi : end)}`
}

function periodLabel(period) {
  if (!period) return 'Итого'
  if (report.value.interval === 'month') return monthName(new Date(period), 'long')
  return report.value.interval === 'week' ? weekLabel(period) : date(period)
}

const docsHint = computed(
  () => `${report.value.total.documents} ${pluralRu(report.value.total.documents, ['продажа', 'продажи', 'продаж'])}`,
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = { interval: interval.value }
    if (from.value) params.from = from.value
    // Верхняя граница на бэкенде исключающая (doc_date < :to) — иначе последний день выпадет.
    if (to.value) params.to = dayAfter(to.value)
    if (category.value) params.category = category.value
    params.currency = currency.value
    report.value = await salesAnalysis(params)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  categoryList.value = await categories.list().catch(() => [])
  load()
})

watch([interval, currency, category, from, to], load)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
        <button
          v-for="i in INTERVALS"
          :key="i.value"
          type="button"
          class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition select-none"
          :class="
            interval === i.value
              ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="interval = i.value"
        >
          {{ i.label }}
        </button>
      </div>

      <div class="w-32 shrink-0">
        <CurrencyToggle v-model="currency" />
      </div>

      <select v-model="category" class="input w-auto">
        <option value="">Все категории</option>
        <option v-for="c in categoryList" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
      </select>

      <!--
        Свой переключатель вместо общего DateRangeFilter: тому нужны «Сегодня» и
        выбор конкретной даты, а здесь шаг задаёт разрез, и обе кнопки лишние.
        Возврат к текущему периоду повесили на саму подпись.
      -->
      <div class="inline-flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Предыдущий период"
          @click="shiftPeriod(-1)"
        >
          <AppIcon name="chevronLeft" :size="18" />
        </button>
        <button
          type="button"
          class="min-w-[110px] rounded-md px-2 py-1 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 sm:min-w-[140px] dark:text-slate-200 dark:hover:bg-slate-800"
          title="Вернуться к текущему периоду"
          @click="goToday"
        >
          <span class="sm:hidden">{{ periodLabelShort }}</span>
          <span class="hidden sm:inline">{{ periodLabelLong }}</span>
        </button>
        <button
          type="button"
          class="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Следующий период"
          :disabled="atCurrentPeriod"
          @click="shiftPeriod(1)"
        >
          <AppIcon name="chevronRight" :size="18" />
        </button>
      </div>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
      {{ error }}
    </p>

    <Spinner v-if="loading" />

    <template v-else-if="report.rows.length">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard compact label="Выручка" :value="sum(report.total.revenue)" :hint="docsHint" icon="cart" tone="blue" />
        <StatCard
          compact
          label="Себестоимость"
          :value="sum(report.total.cost)"
          hint="По партиям, из которых ушёл товар"
          icon="boxes"
          tone="slate"
        />
        <StatCard
          compact
          label="Прибыль"
          :value="sum(report.total.profit)"
          hint="Выручка минус себестоимость"
          icon="trendUp"
          tone="green"
        />
        <StatCard
          compact
          label="Маржа"
          :value="percent(report.total.margin)"
          hint="Доля прибыли в выручке"
          icon="trendUp"
          :tone="Number(report.total.margin) < 0 ? 'red' : 'amber'"
        />
      </div>

      <div class="card overflow-hidden">
        <!-- Телефон: карточки, семь колонок в 360 px не живут -->
        <div class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
          <div v-for="row in report.rows" :key="row.period" class="p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium text-slate-800 dark:text-slate-100">{{ periodLabel(row.period) }}</div>
                <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {{ row.documents }} {{ pluralRu(row.documents, ['продажа', 'продажи', 'продаж']) }} · {{ qty(row.quantity) }} ед.
                </div>
              </div>
              <div class="shrink-0 text-right">
                <div class="tabnum text-sm font-semibold text-slate-800 dark:text-slate-100">{{ moneyShort(row.revenue, cur) }}</div>
                <div class="tabnum text-xs" :class="marginTone(row.margin)">{{ percent(row.margin) }}</div>
              </div>
            </div>
            <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              прибыль <span class="tabnum">{{ sum(row.profit) }}</span>
            </div>
          </div>
        </div>

        <table class="hidden w-full sm:table">
          <thead>
            <tr>
              <th class="th">Период</th>
              <th class="th text-right">Продаж</th>
              <th class="th text-right">Количество</th>
              <th class="th text-right">Выручка</th>
              <th class="th text-right">Себестоимость</th>
              <th class="th text-right">Прибыль</th>
              <th class="th text-right">Маржа</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.rows" :key="row.period" class="table-row">
              <td class="td font-medium text-slate-700 dark:text-slate-200">{{ periodLabel(row.period) }}</td>
              <td class="td tabnum text-right text-slate-500 dark:text-slate-400">{{ row.documents }}</td>
              <td class="td tabnum text-right text-slate-500 dark:text-slate-400">{{ qty(row.quantity) }}</td>
              <td class="td tabnum text-right font-medium text-slate-800 dark:text-slate-100">{{ sum(row.revenue) }}</td>
              <td class="td tabnum text-right text-slate-500 dark:text-slate-400">{{ sum(row.cost) }}</td>
              <td class="td tabnum text-right text-green-600 dark:text-green-400">{{ sum(row.profit) }}</td>
              <td class="td tabnum text-right" :class="marginTone(row.margin)">{{ percent(row.margin) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/60">
              <td class="td font-semibold text-slate-800 dark:text-slate-100">Итого</td>
              <td class="td tabnum text-right font-medium text-slate-600 dark:text-slate-300">{{ report.total.documents }}</td>
              <td class="td tabnum text-right font-medium text-slate-600 dark:text-slate-300">{{ qty(report.total.quantity) }}</td>
              <td class="td tabnum text-right font-semibold text-slate-800 dark:text-slate-100">{{ sum(report.total.revenue) }}</td>
              <td class="td tabnum text-right font-medium text-slate-600 dark:text-slate-300">{{ sum(report.total.cost) }}</td>
              <td class="td tabnum text-right font-semibold text-green-600 dark:text-green-400">{{ sum(report.total.profit) }}</td>
              <td class="td tabnum text-right font-semibold" :class="marginTone(report.total.margin)">{{ percent(report.total.margin) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </template>

    <EmptyState
      v-else-if="!error"
      icon="cart"
      title="Продаж за период не было"
      text="Отчёт строится по проведённым продажам — выберите другой период."
    />
  </div>
</template>
