<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, qty, dateTime, userName } from '@/utils/format'
import { sales, debts } from '@/api/resources'
import { idFromIri } from '@/api/iri'
import { usePrinterStore } from '@/stores/printer'
import { buildSaleReceipt, printBytes, canPrint } from '@/utils/printer'

const route = useRoute()
const router = useRouter()
const printer = usePrinterStore()

// На Android/десктопе печатаем напрямую на чек-аппарат (ESC/POS по сети), в браузере — системная печать.
const directPrint = canPrint()
const printing = ref(false)
const printError = ref('')

// Доллар в чеке — без знака $ (только число), сум — как есть.
const m = (value, currency) => money(value, currency, currency === 'USD' ? { withCurrency: false } : {})

const sale = ref(null)
const rest = ref({ USD: 0, UZS: 0 })
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    // Всё нужное приходит вложенным в саму продажу (клиент, продавец, позиции) —
    // грузим одним запросом. Плюс долги строго по этой продаже (лёгкий фильтр).
    const s = await sales.get(route.params.id)
    sale.value = s
    const saleDebts = await debts.list({ sale: `/api/sales/${s.id}` }).catch(() => [])
    rest.value = {
      USD: saleDebts.filter((d) => d.currency === 'USD').reduce((sum, d) => sum + Number(d.amount), 0),
      UZS: saleDebts.filter((d) => d.currency === 'UZS').reduce((sum, d) => sum + Number(d.amount), 0),
    }
  } catch {
    sale.value = null
  } finally {
    loading.value = false
  }
}

const paid = computed(() => ({
  USD: Math.max(0, Number(sale.value?.totalUsd ?? 0) - rest.value.USD),
  UZS: Math.max(0, Number(sale.value?.totalUzs ?? 0) - rest.value.UZS),
}))
const paidStr = computed(() =>
  [paid.value.USD ? m(paid.value.USD, 'USD') : null, paid.value.UZS ? m(paid.value.UZS, 'UZS') : null]
    .filter(Boolean)
    .join(' + '),
)
const debtStr = computed(() =>
  [rest.value.USD ? m(rest.value.USD, 'USD') : null, rest.value.UZS ? m(rest.value.UZS, 'UZS') : null]
    .filter(Boolean)
    .join(' + '),
)

function buildReceiptBytes() {
  const totals = []
  if (Number(sale.value.totalUsd) > 0) totals.push({ label: 'Итого ', value: m(sale.value.totalUsd, 'USD') })
  if (Number(sale.value.totalUzs) > 0) totals.push({ label: 'Итого сум', value: m(sale.value.totalUzs, 'UZS') })
  return buildSaleReceipt({
    number: sale.value.number,
    dateStr: dateTime(sale.value.createdAt ?? sale.value.docDate),
    customer: sale.value.customer?.name ?? '',
    seller: userName(sale.value.soldBy),
    items: (sale.value.items ?? []).map((it) => ({
      name: it.product?.name ?? '—',
      qty: qty(it.quantity),
      price: m(it.price, it.currency),
      total: m(it.total, it.currency),
    })),
    totals,
    paid: paidStr.value,
    debt: debtStr.value,
    width: Number(printer.width),
  })
}

async function doPrint() {
  printError.value = ''
  // Браузер: только системная печать (сокета в вебе нет).
  if (!directPrint) {
    window.print()
    return
  }
  // Android/десктоп: прямая печать на чек-аппарат по сети.
  if (!printer.ip) {
    printError.value = 'Укажите IP чек-аппарата в «Настройки принтера»'
    return
  }
  printing.value = true
  try {
    await printBytes({ ip: printer.ip, port: printer.port, bytes: buildReceiptBytes() })
  } catch (e) {
    printError.value = e.message
  } finally {
    printing.value = false
  }
}

function doClose() {
  // Десктоп открывает чек отдельным окном → закрываем его. В вебвью/вкладке
  // window.close() не срабатывает — тогда возвращаемся назад.
  window.close()
  setTimeout(() => {
    if (window.closed) return
    if (window.history.length > 1) router.back()
    else router.push('/sales')
  }, 150)
}

onMounted(async () => {
  await load()
  // Сразу печатаем после загрузки — чтобы не жать «Печать» вторым тапом.
  if (sale.value) setTimeout(doPrint, 500)
})
</script>

<template>
  <div v-if="loading" class="p-8 text-sm text-slate-500">Загрузка…</div>

  <div v-else-if="sale" class="receipt-screen">
    <div class="no-print mb-3 flex gap-2">
      <button class="btn-primary" :disabled="printing" @click="doPrint">
        <AppIcon name="print" :size="17" /> {{ printing ? 'Печать…' : 'Печать' }}
      </button>
      <button class="btn-ghost" @click="doClose">Закрыть</button>
    </div>
    <div v-if="printError" class="no-print mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ printError }}</div>

    <div class="receipt">
      <div class="center">
        <div>г. Самарканд, ул. Зарафшон шох</div>
        <div>тел. +998 95 096-15-10</div>
      </div>
      <div class="hr"></div>

      <div class="rowb"><span>Чек № {{ sale.number }}</span><span>{{ dateTime(sale.createdAt ?? sale.docDate) }}</span></div>
      <div v-if="sale.customer?.name">Покупатель: {{ sale.customer.name }}</div>
      <div class="hr"></div>

      <div v-for="it in sale.items ?? []" :key="it.id ?? it['@id']" class="item">
        <div>{{ it.product?.name ?? '—' }}</div>
        <div class="rowb">
          <span>{{ qty(it.quantity) }} x {{ m(it.price, it.currency) }}</span>
          <span>{{ m(it.total, it.currency) }}</span>
        </div>
      </div>
      <div class="hr"></div>

      <div v-if="Number(sale.totalUsd) > 0" class="rowb bold"><span>Итого $</span><span>{{ m(sale.totalUsd, 'USD') }}</span></div>
      <div v-if="Number(sale.totalUzs) > 0" class="rowb bold"><span>Итого сум</span><span>{{ m(sale.totalUzs, 'UZS') }}</span></div>
      <div v-if="paidStr" class="rowb"><span>Оплачено</span><span>{{ paidStr }}</span></div>
      <div v-if="debtStr" class="rowb"><span>Задолженность</span><span>{{ debtStr }}</span></div>
      <div class="hr"></div>

      <div v-if="sale.soldBy">Продавец: {{ userName(sale.soldBy) }}</div>
      <div class="center thanks">Спасибо за покупку!</div>
    </div>
  </div>

  <EmptyState v-else title="Чек не найден" />
</template>

<style>
/* Компактный чек: узкая колонка, чёрным по белому, две колонки через flex. */
.receipt-screen {
  min-height: 100vh;
  background: #fff;
  color: #000;
  padding: 12px;
}
.receipt {
  width: 72mm;
  max-width: 100%;
  margin: 0 auto;
  font-family: 'Menlo', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.4;
  color: #000;
}
.receipt .center { text-align: center; }
.receipt .rowb { display: flex; justify-content: space-between; gap: 8px; }
.receipt .rowb > span:last-child { white-space: nowrap; }
.receipt .bold { font-weight: 700; }
.receipt .item { margin-bottom: 4px; }
.receipt .hr { border-top: 1px dashed #000; margin: 5px 0; }
.receipt .thanks { margin-top: 8px; }

@media print {
  .no-print { display: none !important; }
  .receipt-screen { padding: 0; }
  .receipt { width: auto; }
  @page { size: 80mm auto; margin: 3mm; }
}
</style>
