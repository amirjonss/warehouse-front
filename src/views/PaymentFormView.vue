<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, toISODate } from '@/utils/format'
import { autoAllocatePayment, cashSessions, clients, exchangeRates, paymentAllocations, payments, sales, changePaymentStatus } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { useAuthStore } from '@/stores/auth'

const toast = useToastStore()
const confirmStore = useConfirmStore()
const auth = useAuthStore()

const route = useRoute()
const router = useRouter()

const METHOD = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' }

const client = ref(null)
const error = ref('')
const loadingClient = ref(true)

const header = reactive({ amount: '', currency: 'UZS', method: 'cash', docDate: toISODate() })
/** Долларов нет на карте и в банке — бэк принимает USD только наличными. */
watch(
  () => header.currency,
  (c) => {
    if (c === 'USD' && header.method !== 'cash') header.method = 'cash'
  },
)
/** Есть ли у текущего сотрудника открытая смена — от этого зависит приём наличных. */
const hasOpenSession = ref(false)
const draft = ref(null)
const posting = ref(false)
const referenceRate = ref('')

const debtLines = ref([]) // { saleId, saleNumber, currency, remaining }
const selected = reactive({}) // key `${saleId}:${currency}` -> { amountSpent, payRate, created }
const loadingLines = ref(true)

async function load() {
  loadingClient.value = true
  loadingLines.value = true
  error.value = ''
  try {
    const [c, rates, mySales, mySessions] = await Promise.all([
      clients.get(route.params.id),
      exchangeRates.list({ 'order[createdAt]': 'desc', itemsPerPage: 1 }),
      sales.list({ customer: route.params.id }),
      // Наличные без открытой смены провести нельзя — предупреждаем до ввода сумм,
      // а не отказом на кнопке «Провести».
      cashSessions.list({ user: `/api/users/${auth.user.id}`, status: 'open', itemsPerPage: 1 }),
    ])
    client.value = c
    referenceRate.value = rates[0]?.rateBuy ?? ''
    hasOpenSession.value = mySessions.length > 0

    // Долг берём прямо из полей продажи (outstandingUsd/outstandingUzs) — без отдельных запросов к /debts.
    const lines = []
    for (const s of mySales.filter((x) => x.status === 'posted')) {
      const usd = Number(s.outstandingUsd) || 0
      const uzs = Number(s.outstandingUzs) || 0
      if (usd > 0.004) lines.push({ saleId: String(s.id), saleNumber: s.number ?? String(s.id), currency: 'USD', remaining: usd })
      if (uzs > 0.004) lines.push({ saleId: String(s.id), saleNumber: s.number ?? String(s.id), currency: 'UZS', remaining: uzs })
    }
    debtLines.value = lines

    if (route.params.paymentId) await loadExistingDraft(route.params.paymentId)
  } catch (e) {
    error.value = e.message
  } finally {
    loadingClient.value = false
    loadingLines.value = false
  }
}
load()

/**
 * Продолжение существующего черновика: переход с /clients/:id/payment/:paymentId/edit
 * («черновик» в списке оплат карточки клиента). Проведённые/отменённые платежи
 * сюда не редактируются.
 */
async function loadExistingDraft(paymentId) {
  const payment = await payments.get(paymentId)
  if (payment.status !== 'draft') {
    router.replace(`/clients/${route.params.id}`)
    return
  }
  draft.value = payment
  header.amount = payment.amount
  header.currency = payment.currency
  header.method = payment.method
  header.docDate = toISODate(payment.docDate)

  const allocs = await paymentAllocations.list({ payment: paymentId })
  for (const a of allocs) {
    const key = `${idFromIri(a.sale)}:${a.currency}`
    selected[key] = { amountSpent: a.amountSpent, payRate: a.payRate ?? '', created: a }
  }
}

/** Черновик создаётся прозрачно — как только начинают распределять сумму по накладным. */
async function ensureDraft() {
  if (draft.value) return draft.value
  draft.value = await payments.create({
    docDate: header.docDate,
    client: iri('clients', route.params.id),
    amount: String(header.amount),
    currency: header.currency,
    method: header.method,
  })
  return draft.value
}

const canAllocate = computed(() => Number(header.amount) > 0)

/** Сумма непогашенного долга клиента в валюте платежа — по ней проверяем возможность автораспределения до создания черновика. */
const outstandingInCurrency = computed(() =>
  debtLines.value.filter((l) => l.currency === header.currency).reduce((s, l) => s + Number(l.remaining), 0),
)

/** Общий долг клиента раздельно по валютам — для сводки над списком накладных. */
const totalDebt = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const l of debtLines.value) acc[l.currency] += Number(l.remaining)
  return acc
})

function toggle(line) {
  const key = `${line.saleId}:${line.currency}`
  if (selected[key]) {
    delete selected[key]
  } else {
    selected[key] = {
      amountSpent: '',
      payRate: line.currency === header.currency ? '' : referenceRate.value,
      created: null,
    }
  }
}

function needsRate(line) {
  return line.currency !== header.currency
}

function previewClosed(line) {
  const s = selected[`${line.saleId}:${line.currency}`]
  if (!s || !s.amountSpent) return 0
  if (line.currency === header.currency) return Number(s.amountSpent)
  if (line.currency === 'USD') return s.payRate ? Number(s.amountSpent) / Number(s.payRate) : 0
  return s.payRate ? Number(s.amountSpent) * Number(s.payRate) : 0
}

const totalAllocated = computed(() =>
  Object.values(selected).reduce((sum, s) => sum + (Number(s.amountSpent) || 0), 0),
)
const overAllocated = computed(() => Number(header.amount) > 0 && totalAllocated.value > Number(header.amount) + 0.004)
/** Бэкенд не даёт провести платёж, пока не распределена вся сумма — авансов/переплат мы не ведём. */
const remainingToAllocate = computed(() => Math.max(0, Number(header.amount) - totalAllocated.value))
const fullyAllocated = computed(() => Number(header.amount) > 0 && remainingToAllocate.value <= 0.004 && !overAllocated.value)

async function saveAllocations() {
  if (!canAllocate.value) return
  error.value = ''
  try {
    await ensureDraft()
    for (const line of debtLines.value) {
      const key = `${line.saleId}:${line.currency}`
      const s = selected[key]
      if (!s || s.created || !s.amountSpent) continue
      const payload = {
        payment: iri('payments', draft.value.id),
        sale: iri('sales', line.saleId),
        currency: line.currency,
        amountSpent: String(s.amountSpent),
        isRounding: false,
      }
      if (needsRate(line)) payload.payRate = String(s.payRate)
      s.created = await paymentAllocations.create(payload)
    }
  } catch (e) {
    error.value = e.message
  }
}

async function post() {
  error.value = ''
  posting.value = true
  try {
    await saveAllocations()
    if (!draft.value) draft.value = await ensureDraft()
    await changePaymentStatus(draft.value.id, 'posted')
    toast.success(`${draft.value.number} проведён`)
    router.push(`/clients/${route.params.id}`)
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}

/**
 * Автораспределение: бэкенд сам закроет долги клиента в валюте платежа от старых к
 * новым и сразу проведёт платёж. Существующее ручное распределение при этом перезапишется.
 */
async function autoAllocate() {
  if (!canAllocate.value) return
  // Проверяем ДО создания черновика: иначе останется висеть черновик с заблокированной валютой, в которой нет долга.
  if (outstandingInCurrency.value <= 0.004) {
    error.value = `У клиента нет непогашенного долга в валюте ${header.currency}.`
    return
  }
  if (Number(header.amount) > outstandingInCurrency.value + 0.004) {
    error.value = `Сумма платежа превышает долг клиента в валюте ${header.currency} (${money(outstandingInCurrency.value, header.currency)}).`
    return
  }
  if (
    !(await confirmStore.ask(
      `Распределить ${money(header.amount, header.currency)} по долгам клиента (от старых к новым) и провести платёж?`,
      { confirmLabel: 'Распределить и провести', danger: false },
    ))
  )
    return
  error.value = ''
  posting.value = true
  try {
    const p = await ensureDraft()
    const posted = await autoAllocatePayment(p.id)
    toast.success(`${posted?.number ?? draft.value.number} проведён`)
    router.push(`/clients/${route.params.id}`)
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="space-y-6 pb-32 xl:pb-0">
    <button class="btn-ghost btn-sm" @click="router.back()">
      <AppIcon name="chevronLeft" :size="16" /> Назад
    </button>

    <p v-if="error" class="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div v-if="!loadingClient" class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_336px]">
      <!--
        На планшете/мобильном (< xl) карточка «Новый платёж» должна идти первой,
        поэтому визуальный порядок задаём через order, а не переставляем разметку.
      -->
      <div class="order-2 flex min-w-0 flex-col gap-6 xl:order-1 xl:min-h-[calc(100vh-7rem)]">
        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Закрыть долг по накладным</h2>
            <div v-if="!loadingLines && (totalDebt.USD > 0 || totalDebt.UZS > 0)" class="flex items-center gap-1.5 text-sm">
              <span class="text-slate-500 dark:text-slate-400">Общий долг:</span>
              <span class="tabnum font-semibold text-amber-600 dark:text-amber-400">
                <template v-if="totalDebt.USD > 0">{{ money(totalDebt.USD, 'USD') }}</template>
                <template v-if="totalDebt.USD > 0 && totalDebt.UZS > 0"> · </template>
                <template v-if="totalDebt.UZS > 0">{{ money(totalDebt.UZS, 'UZS') }}</template>
              </span>
            </div>
          </div>

          <div v-if="loadingLines" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
          <EmptyState v-else-if="!debtLines.length" icon="wallet" title="Нет непогашенных накладных" />
          <div v-else class="space-y-2">
            <div v-for="line in debtLines" :key="`${line.saleId}:${line.currency}`" class="rounded-lg border border-slate-300 p-3 dark:border-slate-800">
              <label class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                  :checked="!!selected[`${line.saleId}:${line.currency}`]"
                  :disabled="!canAllocate || !!selected[`${line.saleId}:${line.currency}`]?.created"
                  @change="toggle(line)"
                />
                <span class="font-medium text-slate-800 dark:text-slate-100">{{ line.saleNumber }}</span>
                <span class="text-slate-500 dark:text-slate-400">осталось {{ money(line.remaining, line.currency) }}</span>
                <span v-if="selected[`${line.saleId}:${line.currency}`]?.created" class="badge ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">добавлено</span>
              </label>

              <div v-if="selected[`${line.saleId}:${line.currency}`] && !selected[`${line.saleId}:${line.currency}`].created" class="mt-2 grid grid-cols-2 gap-2 pl-6 sm:max-w-sm">
                <div>
                  <label class="label">Сумма ({{ header.currency }})</label>
                  <input v-model="selected[`${line.saleId}:${line.currency}`].amountSpent" type="number" step="0.01" class="input" />
                </div>
                <div v-if="needsRate(line)">
                  <label class="label">Курс</label>
                  <input v-model="selected[`${line.saleId}:${line.currency}`].payRate" type="number" step="0.0001" class="input" />
                </div>
                <div class="col-span-2 text-xs text-slate-500 dark:text-slate-400">
                  Закроет ≈ {{ money(previewClosed(line), line.currency) }} из долга в {{ line.currency }}
                </div>
              </div>
            </div>
          </div>

          <p v-if="!canAllocate" class="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Сначала укажите сумму платежа справа — накладные закрываются из неё.
          </p>
          <p v-if="overAllocated" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            Распределено больше, чем принято платежом ({{ money(totalAllocated, header.currency) }} из {{ money(header.amount, header.currency) }}).
          </p>
          <p v-else-if="canAllocate && !fullyAllocated" class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            Осталось распределить {{ money(remainingToAllocate, header.currency) }} — провести платёж можно только когда вся сумма закрыта по накладным.
          </p>

          <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button class="btn-ghost w-full sm:w-auto" :disabled="!canAllocate || overAllocated" @click="saveAllocations">
              <AppIcon name="check" :size="14" /> Сохранить распределение
            </button>
            <button
              class="btn-primary w-full sm:w-auto"
              :disabled="!canAllocate || posting || outstandingInCurrency <= 0.004"
              title="Закрыть долги от старых к новым и сразу провести"
              @click="autoAllocate"
            >
              <AppIcon name="check" :size="14" /> Распределить автоматически
            </button>
          </div>
        </section>
      </div>

      <!-- Панель документа: клиент, сумма, способ, дата и проводка — закреплена справа, тянется на всю высоту -->
      <aside class="order-1 flex flex-col xl:order-2 xl:sticky xl:top-20 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad flex flex-1 flex-col rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Новый платёж</h2>
            <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{{ client?.name }}</p>

          <div class="mt-5 space-y-5">
            <div>
              <label class="label">Сумма</label>
              <input v-model="header.amount" type="number" step="0.01" class="input" :disabled="!!draft" />
            </div>
            <div>
              <label class="label">Валюта</label>
              <div class="flex gap-2">
                <button
                  type="button"
                  v-for="c in ['UZS', 'USD']"
                  :key="c"
                  class="btn-ghost btn-sm flex-1"
                  :disabled="!!draft"
                  :class="{ 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300': header.currency === c }"
                  @click="header.currency = c"
                >
                  {{ c }}
                </button>
              </div>
            </div>
            <div>
              <label class="label">Способ оплаты</label>
              <select v-model="header.method" class="input" :disabled="!!draft">
                <option v-for="(label, key) in METHOD" :key="key" :value="key" :disabled="header.currency === 'USD' && key !== 'cash'">{{ label }}</option>
              </select>
              <p
                v-if="header.currency === 'USD'"
                class="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              >
                Доллары принимаются только наличными — валютного счёта нет.
              </p>
              <p
                v-if="header.method === 'cash' && !hasOpenSession"
                class="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
              >
                У вас нет открытой смены — наличные принять не получится.
                <RouterLink to="/cash" class="font-medium underline">Открыть смену</RouterLink>
              </p>
            </div>
            <div>
              <label class="label">Дата</label>
              <input v-model="header.docDate" type="date" class="input" :disabled="!!draft" />
            </div>
          </div>

          <!-- На планшете/мобильном кнопка уезжает в закреплённую снизу окна панель ниже -->
          <div class="mt-auto hidden space-y-3 border-t border-slate-300 pt-5 xl:block dark:border-slate-800">
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-500 dark:text-slate-400">Распределено</span>
              <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(totalAllocated, header.currency) }}</span>
            </div>
            <button class="btn-primary w-full" :disabled="!fullyAllocated || posting" @click="post">
              Провести платёж
            </button>
          </div>
        </section>
      </aside>
    </div>

    <!-- Закреплённая снизу окна панель с кнопкой проводки — только на планшете и мобильном -->
    <div
      v-if="!loadingClient"
      class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-slate-300 bg-white/95 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:left-[248px] xl:hidden"
    >
      <div class="flex items-center justify-between text-sm">
        <span class="text-slate-500 dark:text-slate-400">Распределено</span>
        <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(totalAllocated, header.currency) }}</span>
      </div>
      <button class="btn-primary w-full" :disabled="!fullyAllocated || posting" @click="post">
        Провести платёж
      </button>
    </div>
  </div>
</template>
