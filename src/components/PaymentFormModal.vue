<script setup>
import { computed, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { money, toISODate } from '@/utils/format'
import {
  debts,
  exchangeRates,
  paymentAllocations,
  payments,
  sales,
  changePaymentStatus,
} from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const props = defineProps({ clientId: { type: [String, Number], required: true }, clientName: { type: String, default: '' } })
const emit = defineEmits(['close', 'saved'])

const METHOD = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' }

const header = reactive({ docDate: toISODate(), amount: '', currency: 'UZS', method: 'cash', note: '' })
const draft = ref(null)
const creatingDraft = ref(false)
const posting = ref(false)
const error = ref('')
const referenceRate = ref('')

const debtLines = ref([]) // { saleId, saleNumber, currency, remaining }
const selected = reactive({}) // key `${saleId}:${currency}` -> { amountSpent, payRate, created }
const loadingLines = ref(true)

async function loadDebtLines() {
  loadingLines.value = true
  try {
    const [rates, allSales, allDebts] = await Promise.all([
      exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 }),
      sales.list(),
      debts.list(),
    ])
    referenceRate.value = rates[0]?.rateBuy ?? ''
    const clientSales = allSales.filter(
      (s) => String(idFromIri(s.customer)) === String(props.clientId) && s.status === 'posted',
    )
    const bySale = new Map()
    for (const d of allDebts) {
      const sid = idFromIri(d.sale)
      if (!clientSales.some((s) => String(s.id) === String(sid))) continue
      const key = `${sid}:${d.currency}`
      bySale.set(key, (bySale.get(key) ?? 0) + Number(d.amount))
    }
    debtLines.value = [...bySale.entries()]
      .filter(([, remaining]) => remaining > 0.004)
      .map(([key, remaining]) => {
        const [saleId, currency] = key.split(':')
        const sale = clientSales.find((s) => String(s.id) === saleId)
        return { saleId, saleNumber: sale?.number ?? saleId, currency, remaining }
      })
  } catch (e) {
    error.value = e.message
  } finally {
    loadingLines.value = false
  }
}
loadDebtLines()

async function createDraft() {
  if (!header.amount || Number(header.amount) <= 0) return
  creatingDraft.value = true
  error.value = ''
  try {
    draft.value = await payments.create({
      docDate: header.docDate,
      client: iri('clients', props.clientId),
      amount: String(header.amount),
      currency: header.currency,
      method: header.method,
      note: header.note || '',
    })
  } catch (e) {
    error.value = e.message
  } finally {
    creatingDraft.value = false
  }
}

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
const overAllocated = computed(() => draft.value && totalAllocated.value > Number(draft.value.amount) + 0.004)

async function saveAllocations() {
  error.value = ''
  try {
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

const hasAllocations = computed(() => Object.values(selected).some((s) => s.created))

async function post() {
  if (!draft.value) return
  posting.value = true
  error.value = ''
  try {
    await saveAllocations()
    await changePaymentStatus(draft.value.id, 'posted')
    emit('saved')
    emit('close')
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <ModalDialog title="Приём оплаты" :subtitle="clientName" width="max-w-2xl" @close="$emit('close')">
    <p v-if="error" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div v-if="!draft" class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Сумма</label>
          <input v-model="header.amount" type="number" step="0.01" class="input" />
        </div>
        <div>
          <label class="label">Валюта</label>
          <div class="flex gap-2">
            <button
              type="button"
              v-for="c in ['UZS', 'USD']"
              :key="c"
              class="btn-ghost btn-sm flex-1"
              :class="{ 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300': header.currency === c }"
              @click="header.currency = c"
            >
              {{ c }}
            </button>
          </div>
        </div>
      </div>
      <div>
        <label class="label">Способ оплаты</label>
        <select v-model="header.method" class="input">
          <option v-for="(label, key) in METHOD" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div>
        <label class="label">Дата</label>
        <input v-model="header.docDate" type="date" class="input" />
      </div>
    </div>

    <div v-else class="space-y-4">
      <div class="rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-600 dark:text-slate-400">
        {{ draft.number }} · принято {{ money(draft.amount, draft.currency) }}
      </div>

      <div>
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Закрыть долг по накладным</div>
        <div v-if="loadingLines" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
        <div v-else-if="!debtLines.length" class="text-sm text-slate-500 dark:text-slate-400">У клиента нет непогашенных накладных.</div>
        <div v-else class="space-y-2">
          <div v-for="line in debtLines" :key="`${line.saleId}:${line.currency}`" class="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                :checked="!!selected[`${line.saleId}:${line.currency}`]"
                :disabled="!!selected[`${line.saleId}:${line.currency}`]?.created"
                @change="toggle(line)"
              />
              <span class="font-medium text-slate-800 dark:text-slate-100">{{ line.saleNumber }}</span>
              <span class="text-slate-500 dark:text-slate-400">осталось {{ money(line.remaining, line.currency) }}</span>
              <span v-if="selected[`${line.saleId}:${line.currency}`]?.created" class="badge ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">добавлено</span>
            </label>

            <div v-if="selected[`${line.saleId}:${line.currency}`] && !selected[`${line.saleId}:${line.currency}`].created" class="mt-2 grid grid-cols-2 gap-2 pl-6">
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
      </div>

      <p v-if="overAllocated" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
        Распределено больше, чем принято платежом ({{ money(totalAllocated, header.currency) }} из {{ money(draft.amount, draft.currency) }}).
      </p>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="$emit('close')">{{ draft ? 'Закрыть' : 'Отмена' }}</button>
      <button v-if="!draft" class="btn-primary" :disabled="!header.amount || creatingDraft" @click="createDraft">
        Далее
      </button>
      <button v-else class="btn-ghost" :disabled="overAllocated" @click="saveAllocations">
        <AppIcon name="check" :size="14" /> Сохранить распределение
      </button>
      <button v-if="draft" class="btn-primary" :disabled="posting || overAllocated" @click="post">
        Провести платёж
      </button>
    </template>
  </ModalDialog>
</template>
