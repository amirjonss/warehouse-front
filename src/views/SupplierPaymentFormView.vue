<script setup>
/**
 * Оплата поставщику — зеркало клиентского платежа. Вместо способа оплаты
 * выбирается счёт компании: валюта платежа берётся из него.
 */
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, toISODate } from '@/utils/format'
import {
  autoAllocateSupplierPayment,
  cashAccounts,
  changeSupplierPaymentStatus,
  exchangeRates,
  receipts,
  supplierPaymentAllocations,
  supplierPayments,
  suppliers,
} from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'

const toast = useToastStore()
const confirmStore = useConfirmStore()

const route = useRoute()
const router = useRouter()

const supplier = ref(null)
const accounts = ref([])
const error = ref('')
const loadingSupplier = ref(true)

const header = reactive({ amount: '', accountId: '', docDate: toISODate() })
const draft = ref(null)
const posting = ref(false)
const referenceRate = ref('')

const debtLines = ref([])
const selected = reactive({})
const loadingLines = ref(true)

const selectedAccount = computed(() => accounts.value.find((a) => String(a.id) === String(header.accountId)) ?? null)
const headerCurrency = computed(() => selectedAccount.value?.currency ?? 'UZS')

async function load() {
  loadingSupplier.value = true
  loadingLines.value = true
  error.value = ''
  try {
    const [s, accs, rates] = await Promise.all([
      suppliers.get(route.params.id),
      cashAccounts.list({ 'order[id]': 'asc' }),
      exchangeRates.list({ 'order[createdAt]': 'desc', itemsPerPage: 1 }),
    ])
    supplier.value = s
    accounts.value = accs.filter((a) => a.isActive !== false)
    referenceRate.value = rates[0]?.rateBuy ?? ''

    const myReceipts = await receipts.list({ supplier: route.params.id })
    const lines = []
    for (const r of myReceipts.filter((x) => x.status === 'posted')) {
      const usd = Number(r.outstandingUsd) || 0
      const uzs = Number(r.outstandingUzs) || 0
      if (usd > 0.004) lines.push({ receiptId: String(r.id), receiptNumber: r.number ?? String(r.id), currency: 'USD', remaining: usd })
      if (uzs > 0.004) lines.push({ receiptId: String(r.id), receiptNumber: r.number ?? String(r.id), currency: 'UZS', remaining: uzs })
    }
    debtLines.value = lines

    if (!header.accountId && accounts.value.length) {
      const prefer = accounts.value.find((a) => Number(s.debtUsd) > 0 && a.currency === 'USD')
        ?? accounts.value.find((a) => Number(s.debtUzs) > 0 && a.currency === 'UZS')
        ?? accounts.value[0]
      header.accountId = String(prefer.id)
    }

    if (route.params.paymentId) await loadExistingDraft(route.params.paymentId)
    else if (route.query.receipt) preselectReceipt(route.query.receipt)
  } catch (e) {
    error.value = e.message
  } finally {
    loadingSupplier.value = false
    loadingLines.value = false
  }
}
load()

function preselectReceipt(receiptId) {
  for (const line of debtLines.value.filter((l) => String(l.receiptId) === String(receiptId))) {
    const key = `${line.receiptId}:${line.currency}`
    if (!selected[key]) toggle(line)
  }
}

async function loadExistingDraft(paymentId) {
  const payment = await supplierPayments.get(paymentId)
  if (payment.status !== 'draft') {
    router.replace(`/suppliers/${route.params.id}`)
    return
  }
  draft.value = payment
  header.amount = payment.amount
  header.accountId = String(idFromIri(payment.account) ?? '')
  header.docDate = toISODate(payment.docDate)

  const allocs = await supplierPaymentAllocations.list({ supplierPayment: paymentId })
  for (const a of allocs) {
    const key = `${idFromIri(a.receipt)}:${a.currency}`
    selected[key] = { amountSpent: a.amountSpent, payRate: a.payRate ?? '', created: a }
  }
}

async function ensureDraft() {
  if (draft.value) return draft.value
  draft.value = await supplierPayments.create({
    docDate: header.docDate,
    supplier: iri('suppliers', route.params.id),
    account: iri('cash_accounts', header.accountId),
    amount: String(header.amount),
    currency: headerCurrency.value,
  })
  return draft.value
}

const canAllocate = computed(() => Number(header.amount) > 0 && !!header.accountId)

const outstandingInCurrency = computed(() =>
  debtLines.value.filter((l) => l.currency === headerCurrency.value).reduce((s, l) => s + Number(l.remaining), 0),
)

const totalDebt = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const l of debtLines.value) acc[l.currency] += Number(l.remaining)
  return acc
})

function toggle(line) {
  const key = `${line.receiptId}:${line.currency}`
  if (selected[key]) {
    delete selected[key]
  } else {
    selected[key] = {
      amountSpent: '',
      payRate: line.currency === headerCurrency.value ? '' : referenceRate.value,
      created: null,
    }
  }
}

function needsRate(line) {
  return line.currency !== headerCurrency.value
}

function previewClosed(line) {
  const s = selected[`${line.receiptId}:${line.currency}`]
  if (!s || !s.amountSpent) return 0
  if (line.currency === headerCurrency.value) return Number(s.amountSpent)
  if (line.currency === 'USD') return s.payRate ? Number(s.amountSpent) / Number(s.payRate) : 0
  return s.payRate ? Number(s.amountSpent) * Number(s.payRate) : 0
}

const totalAllocated = computed(() =>
  Object.values(selected).reduce((sum, s) => sum + (Number(s.amountSpent) || 0), 0),
)
const overAllocated = computed(() => Number(header.amount) > 0 && totalAllocated.value > Number(header.amount) + 0.004)
const remainingToAllocate = computed(() => Math.max(0, Number(header.amount) - totalAllocated.value))
const fullyAllocated = computed(() => Number(header.amount) > 0 && remainingToAllocate.value <= 0.004 && !overAllocated.value)
const overBalance = computed(() => selectedAccount.value && Number(header.amount) > Number(selectedAccount.value.balance) + 0.004)

async function saveAllocations() {
  if (!canAllocate.value) return
  error.value = ''
  try {
    await ensureDraft()
    for (const line of debtLines.value) {
      const key = `${line.receiptId}:${line.currency}`
      const s = selected[key]
      if (!s || s.created || !s.amountSpent) continue
      const payload = {
        supplierPayment: iri('supplier_payments', draft.value.id),
        receipt: iri('receipts', line.receiptId),
        currency: line.currency,
        amountSpent: String(s.amountSpent),
      }
      if (needsRate(line)) payload.payRate = String(s.payRate)
      s.created = await supplierPaymentAllocations.create(payload)
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
    await changeSupplierPaymentStatus(draft.value.id, 'posted')
    toast.success(`${draft.value.number} проведён`)
    router.push(`/suppliers/${route.params.id}`)
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}

async function autoAllocate() {
  if (!canAllocate.value) return
  if (outstandingInCurrency.value <= 0.004) {
    error.value = `У поставщика нет непогашенного долга в валюте ${headerCurrency.value}.`
    return
  }
  if (Number(header.amount) > outstandingInCurrency.value + 0.004) {
    error.value = `Сумма превышает долг поставщику в валюте ${headerCurrency.value} (${money(outstandingInCurrency.value, headerCurrency.value)}).`
    return
  }
  if (
    !(await confirmStore.ask(
      `Распределить ${money(header.amount, headerCurrency.value)} по приходам (от старых к новым) и провести оплату?`,
      { confirmLabel: 'Распределить и провести', danger: false },
    ))
  )
    return
  error.value = ''
  posting.value = true
  try {
    const p = await ensureDraft()
    const posted = await autoAllocateSupplierPayment(p.id)
    toast.success(`${posted?.number ?? draft.value.number} проведён`)
    router.push(`/suppliers/${route.params.id}`)
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

    <div v-if="!loadingSupplier" class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_336px]">
      <div class="order-2 flex min-w-0 flex-col gap-6 xl:order-1 xl:min-h-[calc(100vh-7rem)]">
        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Закрыть долг по приходам</h2>
            <div v-if="!loadingLines && (totalDebt.USD > 0 || totalDebt.UZS > 0)" class="flex items-center gap-1.5 text-sm">
              <span class="text-slate-500 dark:text-slate-400">Мы должны:</span>
              <span class="tabnum font-semibold text-amber-600 dark:text-amber-400">
                <template v-if="totalDebt.USD > 0">{{ money(totalDebt.USD, 'USD') }}</template>
                <template v-if="totalDebt.USD > 0 && totalDebt.UZS > 0"> · </template>
                <template v-if="totalDebt.UZS > 0">{{ money(totalDebt.UZS, 'UZS') }}</template>
              </span>
            </div>
          </div>

          <div v-if="loadingLines" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
          <EmptyState v-else-if="!debtLines.length" icon="wallet" title="Нет неоплаченных приходов" />
          <div v-else class="space-y-2">
            <div v-for="line in debtLines" :key="`${line.receiptId}:${line.currency}`" class="rounded-lg border border-slate-300 p-3 dark:border-slate-800">
              <label class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                  :checked="!!selected[`${line.receiptId}:${line.currency}`]"
                  :disabled="!canAllocate || !!selected[`${line.receiptId}:${line.currency}`]?.created"
                  @change="toggle(line)"
                />
                <span class="font-medium text-slate-800 dark:text-slate-100">{{ line.receiptNumber }}</span>
                <span class="text-slate-500 dark:text-slate-400">осталось {{ money(line.remaining, line.currency) }}</span>
                <span v-if="selected[`${line.receiptId}:${line.currency}`]?.created" class="badge ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">добавлено</span>
              </label>

              <div v-if="selected[`${line.receiptId}:${line.currency}`] && !selected[`${line.receiptId}:${line.currency}`].created" class="mt-2 grid grid-cols-2 gap-2 pl-6 sm:max-w-sm">
                <div>
                  <label class="label">Сумма ({{ headerCurrency }})</label>
                  <input v-model="selected[`${line.receiptId}:${line.currency}`].amountSpent" type="number" step="0.01" class="input" />
                </div>
                <div v-if="needsRate(line)">
                  <label class="label">Курс</label>
                  <input v-model="selected[`${line.receiptId}:${line.currency}`].payRate" type="number" step="0.0001" class="input" />
                </div>
                <div class="col-span-2 text-xs text-slate-500 dark:text-slate-400">
                  Закроет ≈ {{ money(previewClosed(line), line.currency) }} из долга в {{ line.currency }}
                </div>
              </div>
            </div>
          </div>

          <p v-if="!canAllocate" class="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Сначала укажите сумму и счёт справа — приходы закрываются из них.
          </p>
          <p v-if="overAllocated" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            Распределено больше, чем списано со счёта ({{ money(totalAllocated, headerCurrency) }} из {{ money(header.amount, headerCurrency) }}).
          </p>
          <p v-else-if="canAllocate && !fullyAllocated" class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            Осталось распределить {{ money(remainingToAllocate, headerCurrency) }} — провести можно только когда вся сумма закрыта по приходам.
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

      <aside class="order-1 flex flex-col xl:order-2 xl:sticky xl:top-20 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad flex flex-1 flex-col rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Оплата поставщику</h2>
            <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{{ supplier?.name }}</p>

          <div class="mt-5 space-y-5">
            <div>
              <label class="label">Счёт списания</label>
              <select v-model="header.accountId" class="input" :disabled="!!draft">
                <option value="">Выберите счёт</option>
                <option v-for="a in accounts" :key="a.id" :value="String(a.id)">
                  {{ a.name }} · {{ money(a.balance, a.currency) }}
                </option>
              </select>
              <p v-if="selectedAccount" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Валюта платежа — {{ headerCurrency }}, как на выбранном счёте.
              </p>
            </div>
            <div>
              <label class="label">Сумма{{ selectedAccount ? `, ${headerCurrency}` : '' }}</label>
              <input v-model="header.amount" type="number" step="0.01" class="input" :disabled="!!draft" />
              <p v-if="overBalance" class="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                На счёте {{ money(selectedAccount.balance, headerCurrency) }} — провести не получится.
              </p>
            </div>
            <div>
              <label class="label">Дата</label>
              <input v-model="header.docDate" type="date" class="input" :disabled="!!draft" />
            </div>
          </div>

          <div class="mt-auto hidden space-y-3 border-t border-slate-300 pt-5 xl:block dark:border-slate-800">
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-500 dark:text-slate-400">Распределено</span>
              <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(totalAllocated, headerCurrency) }}</span>
            </div>
            <button class="btn-primary w-full" :disabled="!fullyAllocated || posting" @click="post">
              Провести оплату
            </button>
          </div>
        </section>
      </aside>
    </div>

    <div
      v-if="!loadingSupplier"
      class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-slate-300 bg-white/95 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:left-[248px] xl:hidden"
    >
      <div class="flex items-center justify-between text-sm">
        <span class="text-slate-500 dark:text-slate-400">Распределено</span>
        <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(totalAllocated, headerCurrency) }}</span>
      </div>
      <button class="btn-primary w-full" :disabled="!fullyAllocated || posting" @click="post">
        Провести оплату
      </button>
    </div>
  </div>
</template>
