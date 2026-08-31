<script setup>
/**
 * Один документ на два случая: сдача наличных в банк (валюта та же — суммы
 * должны совпасть) и обмен сумов на доллары (курс объясняет разницу).
 * Черновик после создания не правится — как платёж клиента.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { money, rateFmt, roundMoney, toISODate } from '@/utils/format'
import { iri, idFromIri } from '@/api/iri'
import { cashAccounts, changeMoneyTransferStatus, exchangeRates, moneyTransfers } from '@/api/resources'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const confirmStore = useConfirmStore()

const accounts = ref([])
const error = ref('')
const loading = ref(true)
const posting = ref(false)
const draft = ref(null)
const referenceRate = ref('')

const form = reactive({
  fromId: '',
  toId: '',
  amountSent: '',
  amountReceived: '',
  rate: '',
  docDate: toISODate(),
  note: '',
})

const fromAcc = computed(() => accounts.value.find((a) => String(a.id) === String(form.fromId)) ?? null)
const toAcc = computed(() => accounts.value.find((a) => String(a.id) === String(form.toId)) ?? null)
const isCross = computed(() => !!(fromAcc.value && toAcc.value && fromAcc.value.currency !== toAcc.value.currency))
const toOptions = computed(() => accounts.value.filter((a) => String(a.id) !== String(form.fromId)))

/**
 * Курс всегда «сумов за 1 $». UZS → USD: сумма / курс; USD → UZS: через центы,
 * иначе 8.33 * 12000 во float даёт не 99 960.
 */
function convert(amount, fromCur, toCur, rate) {
  const n = Number(amount)
  const r = Number(rate)
  if (!(n > 0) || !fromCur || !toCur) return ''
  if (fromCur === toCur) return String(roundMoney(n, toCur))
  if (!(r > 0)) return ''
  if (toCur === 'USD') return String(roundMoney(n / r, 'USD'))
  const cents = Math.round(n * 100)
  return String(roundMoney((cents * r) / 100, 'UZS'))
}

/** Какую сумму пользователь ввёл сам — от неё пересчитываем вторую при смене курса. */
const lastEdited = ref('sent')

function fillReceivedFromSent() {
  const next = convert(form.amountSent, fromAcc.value?.currency, toAcc.value?.currency, form.rate)
  if (next !== '') form.amountReceived = next
}

function fillSentFromReceived() {
  const next = convert(form.amountReceived, toAcc.value?.currency, fromAcc.value?.currency, form.rate)
  if (next !== '') form.amountSent = next
}

/** 100 000 сум / 12 000 = 8,333… $ → 8,33 $. Обратно 8,33 × 12 000 = 99 960, не 100 000. */
function snapReceivedToRoundedUsd() {
  fillSentFromReceived()
  const snapped = convert(form.amountSent, fromAcc.value?.currency, toAcc.value?.currency, form.rate)
  if (snapped !== '') form.amountReceived = snapped
}

function onSentInput() {
  if (draft.value) return
  lastEdited.value = 'sent'
  if (!isCross.value) {
    form.amountReceived = form.amountSent
    return
  }
  fillReceivedFromSent()
}

function onReceivedInput() {
  if (draft.value || !isCross.value) return
  lastEdited.value = 'received'
  fillSentFromReceived()
}

function onReceivedBlur() {
  if (draft.value || !isCross.value) return
  snapReceivedToRoundedUsd()
}

function onRateInput() {
  if (draft.value || !isCross.value) return
  const fromReceived =
    lastEdited.value === 'received' || (!(Number(form.amountSent) > 0) && Number(form.amountReceived) > 0)
  if (fromReceived) snapReceivedToRoundedUsd()
  else fillReceivedFromSent()
}

function reconcileForSubmit() {
  if (!isCross.value) {
    form.amountReceived = form.amountSent
    return
  }
  if (lastEdited.value === 'received') snapReceivedToRoundedUsd()
  else fillReceivedFromSent()
}

const canSubmit = computed(() => {
  if (!fromAcc.value || !toAcc.value) return false
  if (!(Number(form.amountSent) > 0) || !(Number(form.amountReceived) > 0)) return false
  if (isCross.value && !(Number(form.rate) > 0)) return false
  return true
})

/** Красным только если обе суммы введены так, что ни одна не получается из другой. */
const rateMismatch = computed(() => {
  if (!isCross.value || !(Number(form.rate) > 0)) return false
  if (!(Number(form.amountSent) > 0) || !(Number(form.amountReceived) > 0)) return false
  const expectedReceived = convert(form.amountSent, fromAcc.value.currency, toAcc.value.currency, form.rate)
  const expectedSent = convert(form.amountReceived, toAcc.value.currency, fromAcc.value.currency, form.rate)
  if (expectedReceived === '' || expectedSent === '') return false
  const recvOk = Math.abs(Number(expectedReceived) - Number(form.amountReceived)) <= 0.01
  const sentOk = Math.abs(Number(expectedSent) - Number(form.amountSent)) <= 0.005
  return !recvOk && !sentOk
})

/** Всегда считаем сумы из долларов: 8,33 $ × 12 000 = 99 960 сўм, а не «100 000». */
const conversionHint = computed(() => {
  if (!isCross.value || !fromAcc.value || !toAcc.value || !(Number(form.rate) > 0)) return ''
  const usdAmount = fromAcc.value.currency === 'USD' ? form.amountSent : form.amountReceived
  const uzsAmount = fromAcc.value.currency === 'UZS' ? form.amountSent : form.amountReceived
  const usd = Number(usdAmount) > 0 ? usdAmount : convert(uzsAmount, 'UZS', 'USD', form.rate)
  const uzs = convert(usd, 'USD', 'UZS', form.rate)
  if (!(Number(usd) > 0) || !(Number(uzs) > 0)) return ''
  return `${money(usd, 'USD')} × ${rateFmt(form.rate)} = ${money(uzs, 'UZS')}`
})

const fromBalance = computed(() => (fromAcc.value ? Number(fromAcc.value.balance) : 0))
const overBalance = computed(() => Number(form.amountSent) > fromBalance.value + 0.004)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [list, rates] = await Promise.all([
      cashAccounts.list({ 'order[id]': 'asc' }),
      exchangeRates.list({ 'order[createdAt]': 'desc', itemsPerPage: 1 }),
    ])
    accounts.value = list.filter((a) => a.isActive !== false)
    referenceRate.value = rates[0]?.rateBuy ?? rates[0]?.rateSell ?? ''
    if (route.params.id) await loadExisting(route.params.id)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
load()

async function loadExisting(id) {
  const t = await moneyTransfers.get(id)
  if (t.status !== 'draft') {
    router.replace('/transfers')
    return
  }
  draft.value = t
  form.fromId = String(idFromIri(t.fromAccount) ?? '')
  form.toId = String(idFromIri(t.toAccount) ?? '')
  form.amountSent = t.amountSent
  form.amountReceived = t.amountReceived
  form.rate = t.rate ?? ''
  form.docDate = toISODate(t.docDate)
  form.note = t.note ?? ''
}

watch(
  () => form.fromId,
  (id) => {
    if (String(form.toId) === String(id)) form.toId = ''
  },
)

watch(
  () => [form.fromId, form.toId],
  () => {
    if (draft.value) return
    if (isCross.value) {
      if (!form.rate && referenceRate.value) form.rate = referenceRate.value
      onRateInput()
    } else {
      form.rate = ''
      form.amountReceived = form.amountSent
    }
  },
)

async function ensureDraft() {
  if (draft.value) return draft.value
  reconcileForSubmit()
  draft.value = await moneyTransfers.create({
    docDate: form.docDate,
    fromAccount: iri('cash_accounts', form.fromId),
    toAccount: iri('cash_accounts', form.toId),
    amountSent: String(form.amountSent),
    amountReceived: String(form.amountReceived),
    rate: isCross.value ? String(form.rate) : null,
    note: form.note.trim() || null,
  })
  return draft.value
}

async function saveDraft() {
  if (!canSubmit.value) return
  error.value = ''
  try {
    const t = await ensureDraft()
    toast.success(`${t.number} сохранён как черновик`)
    router.push('/transfers')
  } catch (e) {
    error.value = e.message
  }
}

async function post() {
  if (!canSubmit.value) return
  error.value = ''
  posting.value = true
  try {
    const t = await ensureDraft()
    await changeMoneyTransferStatus(t.id, 'posted')
    toast.success(`${t.number} проведён`)
    router.push('/wallet')
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}

async function removeDraft() {
  if (!draft.value) {
    router.back()
    return
  }
  if (!(await confirmStore.ask(`Удалить черновик «${draft.value.number}»?`))) return
  try {
    await moneyTransfers.remove(draft.value.id)
    router.push('/transfers')
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-6 pb-32 xl:pb-0">
    <button class="btn-ghost btn-sm" @click="router.back()">
      <AppIcon name="chevronLeft" :size="16" /> Назад
    </button>

    <p v-if="error" class="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div v-if="!loading" class="mx-auto w-full max-w-xl space-y-6">
      <section class="card-pad rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">{{ draft ? 'Черновик перевода' : 'Новый перевод' }}</h2>
          <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
        </div>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Сдача в банк — суммы совпадают. Обмен валюты — укажите курс, по которому меняли.
        </p>

        <div class="mt-5 space-y-5">
          <div>
            <label class="label">Счёт списания</label>
            <select v-model="form.fromId" class="input" :disabled="!!draft">
              <option value="">Выберите счёт</option>
              <option v-for="a in accounts" :key="a.id" :value="String(a.id)">
                {{ a.name }} · {{ money(a.balance, a.currency) }}
              </option>
            </select>
          </div>
          <div>
            <label class="label">Счёт зачисления</label>
            <select v-model="form.toId" class="input" :disabled="!!draft">
              <option value="">Выберите счёт</option>
              <option v-for="a in toOptions" :key="a.id" :value="String(a.id)">
                {{ a.name }} · {{ money(a.balance, a.currency) }}
              </option>
            </select>
          </div>
          <div>
            <label class="label">Списать{{ fromAcc ? `, ${fromAcc.currency}` : '' }}</label>
            <input v-model="form.amountSent" type="number" step="0.01" class="input" :disabled="!!draft" @input="onSentInput" />
            <p v-if="fromAcc" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              На счёте {{ money(fromAcc.balance, fromAcc.currency) }}
            </p>
            <p v-if="overBalance" class="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              Сумма больше остатка — провести не получится.
            </p>
          </div>
          <div v-if="isCross">
            <label class="label">Курс (сўм за 1 $)</label>
            <input v-model="form.rate" type="number" step="0.0001" class="input" :disabled="!!draft" @input="onRateInput" />
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ conversionHint || 'Курс и любая из сумм — вторую посчитаем сами.' }}
            </p>
          </div>
          <div v-if="isCross">
            <label class="label">Зачислить, {{ toAcc?.currency }}</label>
            <input
              v-model="form.amountReceived"
              type="number"
              step="0.01"
              class="input"
              :disabled="!!draft"
              @input="onReceivedInput"
              @blur="onReceivedBlur"
            />
            <p v-if="rateMismatch" class="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
              Сумма не сходится с курсом — проверьте курс или суммы.
            </p>
          </div>
          <div>
            <label class="label">Дата</label>
            <input v-model="form.docDate" type="date" class="input" :disabled="!!draft" />
          </div>
          <div>
            <label class="label">Комментарий</label>
            <input v-model="form.note" class="input" :disabled="!!draft" placeholder="Необязательно" />
          </div>
        </div>

        <div class="mt-6 hidden space-y-3 border-t border-slate-300 pt-5 xl:block dark:border-slate-800">
          <button class="btn-primary w-full" :disabled="!canSubmit || posting || rateMismatch" @click="post">
            Провести перевод
          </button>
          <button class="btn-ghost w-full" :disabled="!canSubmit || posting || !!draft" @click="saveDraft">
            Сохранить черновик
          </button>
          <button v-if="draft" class="btn-ghost w-full text-red-600 dark:text-red-400" @click="removeDraft">
            Удалить черновик
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="!loading"
      class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-slate-300 bg-white/95 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:left-[248px] xl:hidden"
    >
      <button class="btn-primary w-full" :disabled="!canSubmit || posting || rateMismatch" @click="post">
        Провести перевод
      </button>
    </div>
  </div>
</template>
