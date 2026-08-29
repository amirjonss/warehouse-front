<script setup>
/**
 * ABC-анализ: какие товары тянут бизнес, а какие занимают полку.
 *
 * Пороги — доли от общего итога, а не от числа товаров: идём от самого крупного
 * товара вниз, пока накопленная доля не дойдёт до порога A, дальше до B, остаток —
 * C. Отдельного порога у C нет, поэтому в фильтрах его и не спрашиваем.
 *
 * Считает всё бэкенд (POST /products/abc-analysis), здесь только показ: суммы уже
 * приведены к одной валюте, доли посчитаны, строки отсортированы по убыванию.
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CurrencyToggle from '@/components/CurrencyToggle.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import { money, pluralRu, qty, unitLabel } from '@/utils/format'
import { dayAfter, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { categories, productAbcAnalysis } from '@/api/resources'

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')

const METRICS = [
  { value: 'revenue', label: 'Выручка' },
  { value: 'profit', label: 'Прибыль' },
  { value: 'quantity', label: 'Количество' },
]
const metric = ref('revenue')
// Валюта обязательна и ничего не конвертирует: доллары и сумы — два отдельных
// отчёта по одним и тем же продажам, складывать их в одно число нельзя.
const currency = ref('USD')
const category = ref('')
const thresholdA = ref(80)
const thresholdB = ref(95)
const settingsOpen = ref(false)

const categoryList = ref([])

const report = ref({ metric: 'revenue', baseCurrency: 'USD', total: '0', items: [], summary: [] })

const isMoney = computed(() => report.value.metric !== 'quantity')

/** Количество — не деньги: валюты у него нет, и приводить его не к чему. */
const showsCurrency = computed(() => metric.value !== 'quantity')

const CLASS_TONE = {
  A: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  B: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  C: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}
const CLASS_HINT = {
  A: 'Держат оборот — не выпускать из наличия',
  B: 'Середина — следить, но без фанатизма',
  C: 'Хвост — кандидаты на вывод из ассортимента',
}

/** Значение показываем по метрике: деньги в валюте отчёта, количество — с единицей. */
function formatValue(value, unit) {
  if (!isMoney.value) return `${qty(value)}${unit ? ' ' + unitLabel(unit) : ''}`
  return money(value, report.value.baseCurrency ?? 'USD')
}

const percent = (v) => `${Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`

const totalLabel = computed(() => formatValue(report.value.total))

const productsHint = computed(
  () => `${report.value.items.length} ${pluralRu(report.value.items.length, ['товар', 'товара', 'товаров'])} в отчёте`,
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = { metric: metric.value, thresholdA: thresholdA.value, thresholdB: thresholdB.value }
    if (from.value) params.from = from.value
    // Верхняя граница на бэкенде исключающая (doc_date < :to) — иначе последний день выпадет.
    if (to.value) params.to = dayAfter(to.value)
    if (category.value) params.category = category.value
    if (showsCurrency.value) params.currency = currency.value
    report.value = await productAbcAnalysis(params)
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

watch([metric, currency, category, from, to], load)

/** Пороги правят руками — перезапрашиваем только по валидной паре, иначе бэкенд ответит ошибкой. */
const thresholdsValid = computed(() => {
  const a = Number(thresholdA.value)
  const b = Number(thresholdB.value)
  return a > 0 && a < b && b < 100
})
function applyThresholds() {
  if (thresholdsValid.value) load()
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-slate-500 dark:text-slate-400">
      Товары отсортированы по вкладу в
      {{ metric === 'quantity' ? 'проданное количество' : metric === 'profit' ? 'прибыль' : 'выручку' }}<template
        v-if="showsCurrency"
      >
        по продажам в {{ currency === 'UZS' ? 'сўмах' : 'долларах' }}</template
      >. Класс A — первые {{ thresholdA }} % итога, B — до {{ thresholdB }} %, C — весь остаток.
    </p>

    <!-- Метрика решает всё остальное: по количеству валюта не нужна, по деньгам — нужна -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
        <button
          v-for="m in METRICS"
          :key="m.value"
          type="button"
          class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition select-none"
          :class="
            metric === m.value
              ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="metric = m.value"
        >
          {{ m.label }}
        </button>
      </div>

      <!-- Количество — не деньги, валюта ему ни к чему -->
      <div v-if="showsCurrency" class="w-32 shrink-0">
        <CurrencyToggle v-model="currency" />
      </div>

      <select v-model="category" class="input w-auto">
        <option value="">Все категории</option>
        <option v-for="c in categoryList" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
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

      <button class="btn-ghost btn-sm w-full justify-center sm:ml-auto sm:w-auto" @click="settingsOpen = !settingsOpen">
        <AppIcon name="filter" :size="16" /> Пороги
      </button>
    </div>

    <div v-if="settingsOpen" class="card-pad flex flex-wrap items-end gap-3">
      <div>
        <label class="label">Порог A, %</label>
        <input v-model="thresholdA" type="number" min="1" max="99" class="input w-28" @change="applyThresholds" />
      </div>
      <div>
        <label class="label">Порог B, %</label>
        <input v-model="thresholdB" type="number" min="2" max="99" class="input w-28" @change="applyThresholds" />
      </div>
      <p v-if="!thresholdsValid" class="text-xs text-red-600 dark:text-red-400">
        Пороги идут по возрастанию внутри интервала: 0 &lt; A &lt; B &lt; 100.
      </p>
      <p v-else class="text-xs text-slate-400 dark:text-slate-500">
        Классу C порог не нужен — это всё, что осталось после B.
      </p>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
      {{ error }}
    </p>

    <Spinner v-if="loading" />

    <template v-else-if="report.items.length">
      <div class="grid grid-cols-3 gap-2 sm:gap-3">
        <div v-for="row in report.summary" :key="row.class" class="card-pad">
          <div class="flex items-center gap-2">
            <span class="badge" :class="CLASS_TONE[row.class]">{{ row.class }}</span>
            <span class="text-xs text-slate-500 dark:text-slate-400">
              {{ row.products }} {{ pluralRu(row.products, ['товар', 'товара', 'товаров']) }}
            </span>
          </div>
          <div class="tabnum mt-1.5 text-lg font-semibold text-slate-800 dark:text-slate-100">{{ percent(row.share) }}</div>
          <div class="tabnum text-xs text-slate-500 dark:text-slate-400">{{ formatValue(row.value) }}</div>
          <div class="mt-1 hidden text-[11px] text-slate-400 sm:block dark:text-slate-500">{{ CLASS_HINT[row.class] }}</div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Итого за период</div>
          <div class="text-right">
            <div class="tabnum text-sm font-semibold text-slate-800 dark:text-slate-100">{{ totalLabel }}</div>
            <div class="text-[11px] text-slate-400 dark:text-slate-500">{{ productsHint }}</div>
          </div>
        </div>

        <!-- Телефон: карточки, потому что шесть колонок в 360 px не живут -->
        <div class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
          <div v-for="(item, i) in report.items" :key="item.productId" class="flex items-start gap-3 p-4">
            <span class="badge shrink-0" :class="CLASS_TONE[item.class]">{{ item.class }}</span>
            <div class="min-w-0 flex-1">
              <div class="break-words font-medium text-slate-800 dark:text-slate-100">
                {{ i + 1 }}. {{ item.productName }}
              </div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ item.categoryName ?? '—' }}</div>
            </div>
            <div class="shrink-0 text-right">
              <div class="tabnum text-sm font-semibold text-slate-800 dark:text-slate-100">
                {{ formatValue(item.value, item.unit) }}
              </div>
              <div class="tabnum text-xs text-slate-500 dark:text-slate-400">{{ percent(item.share) }}</div>
            </div>
          </div>
        </div>

        <table class="hidden w-full sm:table">
          <thead>
            <tr>
              <th class="th w-10">#</th>
              <th class="th">Товар</th>
              <th class="th">Категория</th>
              <th class="th text-right">{{ isMoney ? 'Сумма' : 'Количество' }}</th>
              <th class="th text-right">Доля</th>
              <th class="th text-right">Накопленная</th>
              <th class="th text-right">Класс</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in report.items" :key="item.productId" class="table-row">
              <td class="td tabnum text-slate-400 dark:text-slate-500">{{ i + 1 }}</td>
              <td class="td">
                <RouterLink :to="`/products/${item.productId}`" class="font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400">
                  {{ item.productName }}
                </RouterLink>
              </td>
              <td class="td text-slate-500 dark:text-slate-400">{{ item.categoryName ?? '—' }}</td>
              <td class="td tabnum text-right font-medium text-slate-800 dark:text-slate-100">
                {{ formatValue(item.value, item.unit) }}
              </td>
              <td class="td tabnum text-right text-slate-600 dark:text-slate-300">{{ percent(item.share) }}</td>
              <td class="td tabnum text-right text-slate-500 dark:text-slate-400">{{ percent(item.cumulativeShare) }}</td>
              <td class="td text-right">
                <span class="badge" :class="CLASS_TONE[item.class]">{{ item.class }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <EmptyState v-else-if="!error" icon="layers" title="Продаж за период не было" text="ABC-анализ строится по проведённым продажам — выберите другой период." />
  </div>
</template>
