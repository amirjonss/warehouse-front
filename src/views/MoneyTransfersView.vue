<script setup>
/**
 * Переводы между счетами компании: сдача наличных в банк (валюта та же,
 * суммы совпадают) и обмен сумов на доллары (курс объясняет разницу).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import Spinner from '@/components/Spinner.vue'
import { date, money, rateFmt } from '@/utils/format'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { idFromIri } from '@/api/iri'
import { api } from '@/api/client'
import { cashAccounts, changeMoneyTransferStatus, moneyTransfers } from '@/api/resources'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const confirmStore = useConfirmStore()
const toast = useToastStore()

const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')
const statusFilter = ref('')
const accounts = ref([])
const opened = ref(null)
const cancelling = ref(false)

const page = ref(1)
const pageSize = 20
const pageItems = ref([])
const totalItems = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

function accountOf(value) {
  const id = String(idFromIri(value) ?? '')
  return accounts.value.find((a) => String(a.id) === id) ?? (typeof value === 'object' ? value : null)
}

function accountName(value) {
  return accountOf(value)?.name ?? '—'
}

function accountCurrency(value) {
  return accountOf(value)?.currency ?? 'UZS'
}

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, 'order[docDate]': 'desc', 'order[id]': 'desc' }
    if (statusFilter.value) params.status = statusFilter.value
    if (from.value) params['docDate[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['docDate[strictly_before]'] = dayAfter(to.value)
    const { items, totalItems: total } = await api.getPage('/money_transfers', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    accounts.value = await cashAccounts.list({ 'order[id]': 'asc' })
  } catch (e) {
    error.value = e.message
  }
  await loadPage(1)
  if (route.query.doc) {
    try {
      opened.value = await moneyTransfers.get(route.query.doc)
    } catch {
      /* документа нет — модалку не открываем */
    }
  }
})

watch([statusFilter, from, to], () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))

function open(t) {
  if (t.status === 'draft') router.push(`/transfers/${t.id}/edit`)
  else opened.value = t
}

async function removeDraft(t) {
  if (!(await confirmStore.ask(`Удалить черновик «${t.number}»?`))) return
  try {
    await moneyTransfers.remove(t.id)
    pageItems.value = pageItems.value.filter((x) => x.id !== t.id)
    totalItems.value -= 1
  } catch (e) {
    error.value = e.message
  }
}

async function cancelTransfer(t) {
  if (!(await confirmStore.ask(`Отменить перевод «${t.number}»? Деньги вернутся на счёт списания.`, { confirmLabel: 'Отменить перевод', danger: true }))) return
  cancelling.value = true
  error.value = ''
  try {
    await changeMoneyTransferStatus(t.id, 'cancelled')
    toast.success(`${t.number} отменён`)
    opened.value = null
    await loadPage(page.value)
  } catch (e) {
    error.value = e.message
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="hidden flex-wrap items-center gap-2 lg:flex">
      <select v-model="statusFilter" class="input w-auto">
        <option value="">Все статусы</option>
        <option value="draft">Черновики</option>
        <option value="posted">Проведённые</option>
        <option value="cancelled">Отменённые</option>
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
      <RouterLink to="/transfers/new" class="btn-primary btn-sm ml-auto">Новый перевод</RouterLink>
    </div>

    <div class="space-y-2 lg:hidden">
      <select v-model="statusFilter" class="input w-full">
        <option value="">Все статусы</option>
        <option value="draft">Черновики</option>
        <option value="posted">Проведённые</option>
        <option value="cancelled">Отменённые</option>
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
      <div class="flex justify-end">
        <RouterLink to="/transfers/new" class="btn-primary btn-sm">Новый перевод</RouterLink>
      </div>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !pageItems.length" />

      <div v-if="pageItems.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="t in pageItems" :key="t.id" class="cursor-pointer p-4" @click="open(t)">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ t.number }}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {{ date(t.docDate) }} · {{ accountName(t.fromAccount) }} → {{ accountName(t.toAccount) }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="badge" :class="STATUS[t.status].cls">{{ STATUS[t.status].label }}</span>
              <button v-if="t.status === 'draft'" class="btn-ghost btn-sm" title="Удалить черновик" @click.stop="removeDraft(t)">
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-2 tabnum text-sm text-slate-700 dark:text-slate-300">
            {{ money(t.amountSent, accountCurrency(t.fromAccount)) }}
            <template v-if="t.rate"> → {{ money(t.amountReceived, accountCurrency(t.toAccount)) }}</template>
          </div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Номер</th>
            <th class="th">Дата</th>
            <th class="th">Откуда</th>
            <th class="th">Куда</th>
            <th class="th">Списано</th>
            <th class="th">Зачислено</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in pageItems" :key="t.id" class="table-row cursor-pointer" @click="open(t)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ t.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(t.docDate) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ accountName(t.fromAccount) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ accountName(t.toAccount) }}</td>
            <td class="td tabnum">{{ money(t.amountSent, accountCurrency(t.fromAccount)) }}</td>
            <td class="td tabnum">{{ money(t.amountReceived, accountCurrency(t.toAccount)) }}</td>
            <td class="td"><span class="badge" :class="STATUS[t.status].cls">{{ STATUS[t.status].label }}</span></td>
            <td class="td text-right">
              <button v-if="t.status === 'draft'" class="btn-ghost btn-sm" title="Удалить черновик" @click.stop="removeDraft(t)">
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="refresh" title="Переводов пока нет" />

      <Pagination
        :page="page"
        :total-pages="totalPages"
        :total-items="totalItems"
        :page-size="pageSize"
        @update:page="page = $event"
      />
    </div>

    <ModalDialog
      v-if="opened"
      :title="opened.number"
      :subtitle="date(opened.docDate)"
      @close="opened = null"
    >
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between gap-3">
          <span class="text-slate-500 dark:text-slate-400">Откуда</span>
          <span class="font-medium text-slate-800 dark:text-slate-100">{{ accountName(opened.fromAccount) }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-slate-500 dark:text-slate-400">Куда</span>
          <span class="font-medium text-slate-800 dark:text-slate-100">{{ accountName(opened.toAccount) }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-slate-500 dark:text-slate-400">Списано</span>
          <span class="tabnum font-semibold">{{ money(opened.amountSent, accountCurrency(opened.fromAccount)) }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-slate-500 dark:text-slate-400">Зачислено</span>
          <span class="tabnum font-semibold">{{ money(opened.amountReceived, accountCurrency(opened.toAccount)) }}</span>
        </div>
        <div v-if="opened.rate" class="flex items-center justify-between gap-3">
          <span class="text-slate-500 dark:text-slate-400">Курс</span>
          <span class="tabnum">{{ rateFmt(opened.rate) }}</span>
        </div>
        <div v-if="opened.note" class="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {{ opened.note }}
        </div>
        <div class="pt-1">
          <span class="badge" :class="STATUS[opened.status].cls">{{ STATUS[opened.status].label }}</span>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
        <button
          v-if="opened.status === 'posted'"
          class="btn-danger"
          :disabled="cancelling"
          @click="cancelTransfer(opened)"
        >
          Отменить перевод
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
