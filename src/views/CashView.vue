<script setup>
/**
 * Подотчёт продавца: сколько наличных у него в сумке, сколько он уже отдал
 * владельцу без подтверждения и сколько собрал всего за смену.
 *
 * Три числа принципиально разные и не складываются:
 *   «В сумке»       — обязательство, которое надо сдать;
 *   «Ждёт приёма»   — деньги отданы, владелец ещё не подтвердил;
 *   «Собрано»       — весь оборот, включая карту и перечисление, которые до
 *                     продавца физически не доходили.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Spinner from '@/components/Spinner.vue'
import StatCard from '@/components/StatCard.vue'
import { dateTime, dualLabel, money, userName } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { api } from '@/api/client'
import { cashSessionSummary, declareHandover, expenses, openCashSession } from '@/api/resources'

const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)
const busy = ref(false)
const error = ref('')

const session = ref(null)
const summary = ref({ balanceUsd: '0', balanceUzs: '0', unconfirmedUsd: '0', unconfirmedUzs: '0', turnover: [] })
const entries = ref([])

const handoverModal = ref(false)
const expenseModal = ref(false)
const formError = ref('')

const blankHandover = () => ({ amount: '', currency: 'UZS', note: '' })
const blankExpense = () => ({ amount: '', currency: 'UZS', description: '' })
const handoverForm = reactive(blankHandover())
const expenseForm = reactive(blankExpense())

const balanceLabel = computed(() => dualLabel(summary.value.balanceUsd, summary.value.balanceUzs))
const unconfirmedLabel = computed(() => dualLabel(summary.value.unconfirmedUsd, summary.value.unconfirmedUzs))

/** Оборот сворачиваем в одну сумму на валюту — «собрано всего» без деления по способам. */
const collectedLabel = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const row of summary.value.turnover) acc[row.currency] += Number(row.total)
  return dualLabel(acc.USD, acc.UZS)
})

const METHOD_LABELS = { cash: 'Наличными', card: 'Картой', transfer: 'Перечислением' }

/** Строки оборота, отсортированные так, чтобы наличные шли первыми. */
const turnoverRows = computed(() =>
  [...summary.value.turnover].sort((a, b) => (a.method === 'cash' ? -1 : b.method === 'cash' ? 1 : 0)),
)

const KIND = {
  collect: { label: 'Принято от клиента', icon: 'wallet', tone: 'text-green-600 dark:text-green-400' },
  expense: { label: 'Расход', icon: 'trendDown', tone: 'text-red-600 dark:text-red-400' },
  handover: { label: 'Сдано владельцу', icon: 'money', tone: 'text-indigo-600 dark:text-indigo-400' },
  shortage: { label: 'Недостача', icon: 'alert', tone: 'text-amber-600 dark:text-amber-400' },
}

/** Отрицательная сумма — деньги ушли; знак показываем явно, чтобы журнал читался. */
function signed(entry) {
  const n = Number(entry.amount)
  const body = money(Math.abs(n), entry.currency)
  return n < 0 ? `− ${body}` : `+ ${body}`
}

async function loadSession() {
  const { items } = await api.getPage('/cash_sessions', {
    page: 1,
    itemsPerPage: 1,
    'user': `/api/users/${auth.user.id}`,
    'status': 'open',
  })
  session.value = items[0] ?? null
}

async function loadDetails() {
  if (!session.value) {
    entries.value = []
    return
  }
  const [sum, journal] = await Promise.all([
    cashSessionSummary(session.value.id),
    api.getPage('/cash_entries', {
      page: 1,
      itemsPerPage: 50,
      session: `/api/cash_sessions/${session.value.id}`,
      'order[occurredAt]': 'desc',
      'order[id]': 'desc',
    }),
  ])
  summary.value = sum
  entries.value = journal.items
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    await loadSession()
    await loadDetails()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function openSession() {
  busy.value = true
  error.value = ''
  try {
    await openCashSession()
    await load()
    toast.success('Смена открыта')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const handoverValid = computed(() => Number(handoverForm.amount) > 0)
const expenseValid = computed(() => Number(expenseForm.amount) > 0 && expenseForm.description.trim())

async function saveHandover() {
  if (!handoverValid.value) return
  busy.value = true
  formError.value = ''
  try {
    await declareHandover(session.value.id, {
      amount: String(handoverForm.amount),
      currency: handoverForm.currency,
      note: handoverForm.note.trim() || null,
    })
    handoverModal.value = false
    await loadDetails()
    toast.success('Записано. Владелец подтвердит приём')
  } catch (e) {
    formError.value = e.message
  } finally {
    busy.value = false
  }
}

async function saveExpense() {
  if (!expenseValid.value) return
  busy.value = true
  formError.value = ''
  try {
    await expenses.create({
      description: expenseForm.description.trim(),
      amount: String(expenseForm.amount),
      currency: expenseForm.currency,
      docDate: new Date().toISOString().slice(0, 10),
    })
    expenseModal.value = false
    await loadDetails()
    toast.success('Расход проведён')
  } catch (e) {
    formError.value = e.message
  } finally {
    busy.value = false
  }
}

function openHandover() {
  Object.assign(handoverForm, blankHandover())
  formError.value = ''
  handoverModal.value = true
}

function openExpense() {
  Object.assign(expenseForm, blankExpense())
  formError.value = ''
  expenseModal.value = true
}
</script>

<template>
  <div class="space-y-4">
    <Spinner v-if="loading" />

    <p v-else-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
      {{ error }}
    </p>

    <EmptyState
      v-else-if="!session"
      icon="money"
      title="Смена не открыта"
      text="Пока смена закрыта, принимать наличные нельзя — деньги некуда записать."
    >
      <button class="btn-primary btn-sm" :disabled="busy" @click="openSession">
        <AppIcon name="plus" :size="16" /> Открыть смену
      </button>
    </EmptyState>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div class="text-sm text-slate-500 dark:text-slate-400">
          Смена <span class="font-medium text-slate-700 dark:text-slate-200">{{ session.number }}</span>
          с {{ dateTime(session.openedAt) }}
        </div>
        <div class="ml-auto flex gap-2">
          <button class="btn-ghost btn-sm" @click="openExpense">
            <AppIcon name="trendDown" :size="16" /> Расход
          </button>
          <button class="btn-primary btn-sm" @click="openHandover">
            <AppIcon name="money" :size="16" /> Сдать деньги
          </button>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="В сумке"
          :value="balanceLabel.primary"
          :sub-value="balanceLabel.secondary"
          hint="Нужно сдать владельцу"
          icon="wallet"
          tone="amber"
        />
        <StatCard
          label="Ждёт подтверждения"
          :value="unconfirmedLabel.primary"
          :sub-value="unconfirmedLabel.secondary"
          hint="Отдано, владелец ещё не принял"
          icon="clock"
          tone="slate"
        />
        <StatCard
          label="Собрано за смену"
          :value="collectedLabel.primary"
          :sub-value="collectedLabel.secondary"
          hint="Вместе с картой и перечислением"
          icon="trendUp"
          tone="green"
        />
      </div>

      <div class="card-pad">
        <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Оборот по способам оплаты</div>
        <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">
          В сумке оказываются только наличные — карта и перечисление уходят сразу на счёт компании.
        </p>
        <div v-if="turnoverRows.length" class="divide-y divide-slate-200 dark:divide-slate-800">
          <div v-for="row in turnoverRows" :key="row.method + row.currency" class="flex items-center justify-between py-2">
            <div class="text-sm text-slate-700 dark:text-slate-300">
              {{ METHOD_LABELS[row.method] ?? row.method }}
              <span class="text-xs text-slate-400">· {{ row.count }}</span>
            </div>
            <div class="tabnum text-sm font-medium" :class="row.method === 'cash' ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'">
              {{ money(row.total, row.currency) }}
            </div>
          </div>
        </div>
        <EmptyState v-else icon="wallet" title="Оплат ещё не было" />
      </div>

      <div class="card overflow-hidden">
        <div class="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
          Журнал наличных
        </div>
        <div v-if="entries.length" class="divide-y divide-slate-200 dark:divide-slate-800">
          <div v-for="e in entries" :key="e.id" class="flex items-start justify-between gap-3 px-4 py-3">
            <div class="flex min-w-0 items-start gap-3">
              <AppIcon :name="KIND[e.kind]?.icon ?? 'list'" :size="16" class="mt-0.5 shrink-0 text-slate-400" />
              <div class="min-w-0">
                <div class="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {{ KIND[e.kind]?.label ?? e.kind }}
                  <span
                    v-if="e.status === 'declared'"
                    class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                  >
                    ждёт подтверждения
                  </span>
                </div>
                <div v-if="e.note" class="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">{{ e.note }}</div>
                <div class="mt-0.5 text-xs text-slate-400">{{ dateTime(e.occurredAt) }} · {{ userName(e.createdBy) }}</div>
              </div>
            </div>
            <div class="tabnum shrink-0 text-sm font-semibold" :class="KIND[e.kind]?.tone">{{ signed(e) }}</div>
          </div>
        </div>
        <EmptyState v-else icon="list" title="Движений ещё не было" />
      </div>
    </template>

    <ModalDialog v-if="handoverModal" title="Сдать деньги владельцу" @close="handoverModal = false" @submit="saveHandover">
      <div class="space-y-3">
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          Запись появится сразу, но останется помеченной, пока владелец не подтвердит приём.
        </p>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class="label">Сумма</label>
            <input v-model="handoverForm.amount" type="number" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Валюта</label>
            <select v-model="handoverForm.currency" class="input">
              <option value="UZS">сўм</option>
              <option value="USD">$</option>
            </select>
          </div>
        </div>
        <div>
          <label class="label">Комментарий</label>
          <input v-model="handoverForm.note" class="input" placeholder="например, отдал на рынке" />
        </div>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {{ formError }}
        </p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="handoverModal = false">Отмена</button>
        <button class="btn-primary" :disabled="busy || !handoverValid" @click="saveHandover">Записать</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="expenseModal" title="Расход из кассы" @close="expenseModal = false" @submit="saveExpense">
      <div class="space-y-3">
        <div>
          <label class="label">На что</label>
          <input v-model="expenseForm.description" class="input" placeholder="например, грузчики" />
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class="label">Сумма</label>
            <input v-model="expenseForm.amount" type="number" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Валюта</label>
            <select v-model="expenseForm.currency" class="input">
              <option value="UZS">сўм</option>
              <option value="USD">$</option>
            </select>
          </div>
        </div>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {{ formError }}
        </p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="expenseModal = false">Отмена</button>
        <button class="btn-primary" :disabled="busy || !expenseValid" @click="saveExpense">Провести</button>
      </template>
    </ModalDialog>
  </div>
</template>
