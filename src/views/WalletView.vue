<script setup>
/**
 * Касса компании — куда деньги попадают после сдачи смены, плюс карта и банк,
 * которых продавец не касается. «На руках у продавцов» сюда не входит:
 * это /cash_sessions/on_hands, и вместе они — вся картина.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import Spinner from '@/components/Spinner.vue'
import StatCard from '@/components/StatCard.vue'
import { dateTime, money } from '@/utils/format'
import { idFromIri } from '@/api/iri'
import { api } from '@/api/client'
import { cashAccounts, setOpeningBalance, walletSummary } from '@/api/resources'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const KIND_ICON = { cash: 'money', card: 'wallet', bank: 'bank' }
const ENTRY_KIND = {
  opening: { label: 'Начальный остаток', tone: 'text-slate-700 dark:text-slate-200' },
  handover: { label: 'Сдача от продавца', tone: 'text-green-600 dark:text-green-400' },
  collect: { label: 'Оплата клиента', tone: 'text-green-600 dark:text-green-400' },
  transfer_out: { label: 'Перевод · списание', tone: 'text-red-600 dark:text-red-400' },
  transfer_in: { label: 'Перевод · зачисление', tone: 'text-green-600 dark:text-green-400' },
  supplier_payment: { label: 'Оплата поставщику', tone: 'text-red-600 dark:text-red-400' },
  expense: { label: 'Расход со счёта', tone: 'text-red-600 dark:text-red-400' },
}

const loading = ref(true)
const error = ref('')
const accounts = ref([])
const summary = ref({ totalUsd: '0', totalUzs: '0', accounts: [] })
const openingIds = ref(new Set())
const selectedId = ref(null)

const entries = ref([])
const entriesLoading = ref(false)
const page = ref(1)
const pageSize = 20
const totalItems = ref(0)

const openingModal = ref(false)
const openingAccount = ref(null)
const openingForm = reactive({ amount: '', note: '' })
const openingError = ref('')
const saving = ref(false)

const selected = computed(() => accounts.value.find((a) => String(a.id) === String(selectedId.value)) ?? null)
const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

function hasOpening(account) {
  return openingIds.value.has(String(account.id))
}

function accountIdOf(entry) {
  return String(idFromIri(entry.account) ?? entry.account?.id ?? '')
}

function signed(entry) {
  const n = Number(entry.amount)
  const cur = entry.account?.currency ?? selected.value?.currency ?? 'UZS'
  const body = money(Math.abs(n), cur)
  return n < 0 ? `− ${body}` : `+ ${body}`
}

function entryTone(entry) {
  return ENTRY_KIND[entry.kind]?.tone ?? 'text-slate-700 dark:text-slate-200'
}

function entryLabel(entry) {
  return ENTRY_KIND[entry.kind]?.label ?? entry.kind
}

async function loadAccounts() {
  const [list, sum, openings] = await Promise.all([
    cashAccounts.list({ 'order[id]': 'asc' }),
    walletSummary(),
    api.getPage('/account_entries', { page: 1, itemsPerPage: 20, kind: 'opening' }),
  ])
  accounts.value = list
  summary.value = sum
  openingIds.value = new Set(openings.items.map((e) => accountIdOf(e)).filter(Boolean))
  if (!selectedId.value && list.length) selectedId.value = list[0].id
}

async function loadEntries(p = page.value) {
  if (!selectedId.value) {
    entries.value = []
    totalItems.value = 0
    return
  }
  entriesLoading.value = true
  try {
    const { items, totalItems: total } = await api.getPage('/account_entries', {
      page: p,
      itemsPerPage: pageSize,
      account: `/api/cash_accounts/${selectedId.value}`,
      'order[occurredAt]': 'desc',
      'order[id]': 'desc',
    })
    entries.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    entriesLoading.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    await loadAccounts()
    await loadEntries(1)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

watch(selectedId, () => {
  page.value = 1
  loadEntries(1)
})
watch(page, (p) => loadEntries(p))

function selectAccount(account) {
  selectedId.value = account.id
}

function openOpening(account) {
  openingAccount.value = account
  openingForm.amount = ''
  openingForm.note = ''
  openingError.value = ''
  openingModal.value = true
}

const openingValid = computed(() => Number(openingForm.amount) > 0)

async function saveOpening() {
  if (!openingValid.value || !openingAccount.value) return
  saving.value = true
  openingError.value = ''
  try {
    await setOpeningBalance(openingAccount.value.id, {
      amount: String(openingForm.amount),
      note: openingForm.note.trim() || null,
    })
    openingModal.value = false
    toast.success(`Начальный остаток по счёту «${openingAccount.value.name}» записан`)
    await load()
  } catch (e) {
    openingError.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        Деньги компании после сдачи смены. Наличные у продавцов сюда не входят.
      </p>
      <RouterLink to="/transfers/new" class="btn-primary btn-sm ml-auto">
        <AppIcon name="arrowRight" :size="16" /> Новый перевод
      </RouterLink>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <Spinner v-if="loading && !accounts.length" />

    <template v-else>
      <div class="grid grid-cols-2 gap-3">
        <StatCard label="Всего, $" :value="money(summary.totalUsd, 'USD')" icon="money" tone="blue" />
        <StatCard label="Всего, сум" :value="money(summary.totalUzs, 'UZS')" icon="wallet" tone="green" />
      </div>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          v-for="a in accounts"
          :key="a.id"
          type="button"
          class="card-pad text-left transition"
          :class="String(a.id) === String(selectedId) ? 'border-indigo-400 ring-1 ring-indigo-400 dark:border-indigo-500 dark:ring-indigo-500' : 'hover:border-indigo-300 dark:hover:border-indigo-500/40'"
          @click="selectAccount(a)"
        >
          <div class="flex items-start gap-3">
            <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <AppIcon :name="KIND_ICON[a.kind] ?? 'wallet'" :size="18" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{{ a.name }}</div>
              <div class="tabnum mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{{ money(a.balance, a.currency) }}</div>
              <button
                v-if="!hasOpening(a)"
                type="button"
                class="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                @click.stop="openOpening(a)"
              >
                Задать начальный остаток
              </button>
            </div>
          </div>
        </button>
      </div>

      <div v-if="selected" class="card overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div class="min-w-0">
            <div class="font-medium text-slate-800 dark:text-slate-100">{{ selected.name }}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400">
              Журнал счёта · остаток {{ money(selected.balance, selected.currency) }}
            </div>
          </div>
          <RouterLink to="/transfers" class="btn-ghost btn-sm ml-auto">Все переводы</RouterLink>
        </div>

        <Spinner v-if="entriesLoading && !entries.length" />
        <div v-else-if="entries.length" class="divide-y divide-slate-200 dark:divide-slate-800">
          <div v-for="e in entries" :key="e.id" class="flex items-start justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <div class="text-sm font-medium" :class="entryTone(e)">{{ entryLabel(e) }}</div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {{ dateTime(e.occurredAt) }}
                <template v-if="e.note"> · {{ e.note }}</template>
              </div>
            </div>
            <div class="tabnum shrink-0 text-sm font-semibold" :class="Number(e.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">
              {{ signed(e) }}
            </div>
          </div>
        </div>
        <EmptyState v-else-if="!entriesLoading" icon="list" title="Движений пока нет" text="Задайте начальный остаток или проведите перевод." />

        <Pagination
          v-if="entries.length"
          :page="page"
          :total-pages="totalPages"
          :total-items="totalItems"
          :page-size="pageSize"
          @update:page="page = $event"
        />
      </div>
    </template>

    <ModalDialog
      v-if="openingModal && openingAccount"
      :title="'Начальный остаток'"
      :subtitle="openingAccount.name"
      @close="openingModal = false"
      @submit="saveOpening"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          Сумма, которая сейчас лежит на этом счёте. Задаётся один раз — потом остаток меняют только документы.
        </p>
        <div>
          <label class="label">Сумма, {{ openingAccount.currency }}</label>
          <input v-model="openingForm.amount" type="number" step="0.01" min="0" class="input" />
        </div>
        <div>
          <label class="label">Комментарий</label>
          <input v-model="openingForm.note" class="input" placeholder="Необязательно" />
        </div>
        <p v-if="openingError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ openingError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="openingModal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving || !openingValid" @click="saveOpening">Записать</button>
      </template>
    </ModalDialog>
  </div>
</template>
