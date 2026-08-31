<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date, dualMoney, money, qty, rateFmt, rawPrice, userName } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { idFromIri } from '@/api/iri'
import {
  cashAccounts,
  changeSupplierPaymentStatus,
  receipts,
  supplierPaymentAllocations,
  supplierPayments,
  suppliers,
} from '@/api/resources'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirmStore = useConfirmStore()

const supplier = ref(null)
const supplierReceipts = ref([])
const supplierPays = ref([])
const accounts = ref([])
const loading = ref(true)
const error = ref('')
const tab = ref('receipts')

const openedPayment = ref(null)
const openedAllocations = ref([])
const openedReceipt = ref(null)
const cancelling = ref(false)

const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [s, myReceipts, myPayments, accs] = await Promise.all([
      suppliers.get(route.params.id),
      receipts.list({ supplier: route.params.id, 'order[id]': 'desc', 'order[docDate]': 'desc' }),
      supplierPayments.list({ supplier: route.params.id, 'order[id]': 'desc', 'order[docDate]': 'desc' }),
      cashAccounts.list({ 'order[id]': 'asc' }).catch(() => []),
    ])
    supplier.value = s
    accounts.value = accs
    supplierReceipts.value = myReceipts
    supplierPays.value = myPayments
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

function remaining(r) {
  return { usd: Number(r.outstandingUsd) || 0, uzs: Number(r.outstandingUzs) || 0 }
}

const balance = computed(() => ({
  usd: Number(supplier.value?.debtUsd) || 0,
  uzs: Number(supplier.value?.debtUzs) || 0,
}))

const hasDebt = computed(() => balance.value.usd > 0 || balance.value.uzs > 0)

async function removePaymentDraft(p) {
  if (!(await confirmStore.ask(`Удалить черновик «${p.number}»?`))) return
  try {
    await supplierPayments.remove(p.id)
    supplierPays.value = supplierPays.value.filter((x) => x.id !== p.id)
  } catch (e) {
    error.value = e.message
  }
}

async function openPayment(p) {
  if (p.status === 'draft') {
    router.push(`/suppliers/${route.params.id}/payment/${p.id}/edit`)
    return
  }
  openedPayment.value = p
  try {
    openedAllocations.value = await supplierPaymentAllocations.list({ supplierPayment: p.id })
  } catch (e) {
    error.value = e.message
    openedAllocations.value = p.allocations ?? []
  }
}

function receiptNumber(v) {
  return supplierReceipts.value.find((r) => String(r.id) === String(idFromIri(v)))?.number ?? '—'
}

async function openReceipt(r) {
  if (r.status === 'draft') {
    router.push(`/receipts/${r.id}/edit`)
    return
  }
  openedReceipt.value = r
  try {
    openedReceipt.value = await receipts.get(r.id)
  } catch (e) {
    error.value = e.message
  }
}

function openReceiptFromAllocation(a) {
  const receipt = supplierReceipts.value.find((r) => String(r.id) === String(idFromIri(a.receipt)))
  if (!receipt) return
  openedPayment.value = null
  openReceipt(receipt)
}

async function cancelPayment(p) {
  if (!(await confirmStore.ask(`Отменить оплату «${p.number}»? Долг по приходам вернётся.`))) return
  cancelling.value = true
  try {
    await changeSupplierPaymentStatus(p.id, 'cancelled')
    openedPayment.value = null
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    cancelling.value = false
  }
}

function accountLabel(p) {
  const a = p.account
  if (a && typeof a === 'object' && a.name) return a.name
  const id = idFromIri(a)
  return accounts.value.find((x) => String(x.id) === String(id))?.name ?? '—'
}
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
  <p v-else-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
  <div v-else-if="supplier" class="space-y-4">
    <div class="flex items-center justify-between">
      <button class="btn-ghost btn-sm" @click="router.back()">
        <AppIcon name="chevronLeft" :size="16" /> Назад
      </button>
      <RouterLink v-if="auth.can('supplierPayments.create') && hasDebt" :to="`/suppliers/${route.params.id}/payment/new`" class="btn-primary btn-sm">
        <AppIcon name="plus" :size="16" /> Оплатить
      </RouterLink>
    </div>

    <div class="card-pad">
      <div class="flex items-center gap-2">
        <div class="text-lg font-semibold text-slate-800 dark:text-slate-100">{{ supplier.name }}</div>
        <span v-if="!supplier.isActive" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">не активен</span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
        <span v-if="supplier.contact">{{ supplier.contact }}</span>
        <span v-if="supplier.phone" class="flex items-center gap-1"><AppIcon name="phone" :size="14" />{{ supplier.phone }}</span>
        <span v-if="supplier.address" class="flex items-center gap-1"><AppIcon name="pin" :size="14" />{{ supplier.address }}</span>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Приходов</div>
        <div class="mt-1 text-lg font-semibold">{{ supplierReceipts.length }}</div>
      </div>
      <div class="card-pad sm:col-span-2">
        <div class="text-xs text-slate-500 dark:text-slate-400">Мы должны</div>
        <div class="mt-1 tabnum text-lg font-semibold" :class="hasDebt ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
          {{ dualMoney(balance.usd, balance.uzs, 'рассчитались') }}
        </div>
      </div>
    </div>

    <div class="flex gap-2 border-b border-slate-300 dark:border-slate-800">
      <button class="px-3 py-2 text-sm font-medium" :class="tab === 'receipts' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'receipts'">
        Приходы
      </button>
      <button class="px-3 py-2 text-sm font-medium" :class="tab === 'pay' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'pay'">
        Оплаты
      </button>
    </div>

    <div v-if="tab === 'receipts'" class="card overflow-hidden">
      <div v-if="supplierReceipts.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="r in supplierReceipts" :key="r.id" class="cursor-pointer p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50" @click="openReceipt(r)">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ r.number }}</div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ date(r.docDate) }} · {{ userName(r.receivedBy) }}</div>
            </div>
            <span class="badge shrink-0" :class="STATUS[r.status].cls">{{ STATUS[r.status].label }}</span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="tabnum text-slate-700 dark:text-slate-300">{{ dualMoney(r.totalUsd, r.totalUzs) }}</span>
            <span class="tabnum" :class="remaining(r).usd > 0 || remaining(r).uzs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'">
              {{ dualMoney(remaining(r).usd, remaining(r).uzs) }}
            </span>
          </div>
        </div>
      </div>

      <table v-if="supplierReceipts.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Приход</th>
            <th class="th">Дата</th>
            <th class="th">Сумма</th>
            <th class="th">К оплате</th>
            <th class="th">Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in supplierReceipts" :key="r.id" class="table-row cursor-pointer" @click="openReceipt(r)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ r.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(r.docDate) }}</td>
            <td class="td tabnum">{{ dualMoney(r.totalUsd, r.totalUzs) }}</td>
            <td
              class="td tabnum"
              :class="remaining(r).usd > 0 || remaining(r).uzs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'"
            >
              {{ dualMoney(remaining(r).usd, remaining(r).uzs) }}
            </td>
            <td class="td"><span class="badge" :class="STATUS[r.status].cls">{{ STATUS[r.status].label }}</span></td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="receipt" title="Приходов пока нет" />
    </div>

    <div v-else class="card overflow-hidden">
      <div v-if="supplierPays.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="p in supplierPays" :key="p.id" class="cursor-pointer p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50" @click="openPayment(p)">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ p.number }}</div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ date(p.docDate) }} · {{ accountLabel(p) }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="badge" :class="STATUS[p.status].cls">{{ STATUS[p.status].label }}</span>
              <button v-if="p.status === 'draft'" class="btn-ghost btn-sm" title="Удалить черновик" @click.stop="removePaymentDraft(p)">
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-2 tabnum text-sm text-red-600 dark:text-red-400">{{ money(p.amount, p.currency) }}</div>
        </div>
      </div>

      <table v-if="supplierPays.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Документ</th>
            <th class="th">Дата</th>
            <th class="th">Сумма</th>
            <th class="th">Счёт</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in supplierPays" :key="p.id" class="table-row cursor-pointer" @click="openPayment(p)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ p.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(p.docDate) }}</td>
            <td class="td tabnum text-red-600 dark:text-red-400">{{ money(p.amount, p.currency) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ accountLabel(p) }}</td>
            <td class="td"><span class="badge" :class="STATUS[p.status].cls">{{ STATUS[p.status].label }}</span></td>
            <td class="td text-right">
              <button v-if="p.status === 'draft'" class="btn-ghost btn-sm" title="Удалить черновик" @click.stop="removePaymentDraft(p)">
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="wallet" title="Оплат пока нет" />
    </div>

    <ModalDialog v-if="openedReceipt" :title="openedReceipt.number" :subtitle="date(openedReceipt.docDate)" @close="openedReceipt = null">
      <div class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="i in openedReceipt.items ?? []" :key="i.id" class="py-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 font-medium text-slate-800 dark:text-slate-100">{{ i.product?.name ?? '—' }}</div>
            <div class="tabnum shrink-0 font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</div>
          </div>
          <div class="tabnum mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ qty(i.quantity) }} × {{ rawPrice(i.price, i.currency) }} {{ i.currency }}</div>
        </div>
      </div>
      <table class="hidden w-full text-sm sm:table">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="py-1.5 pr-3">Товар</th>
            <th class="px-3 py-1.5 text-right">Кол-во</th>
            <th class="px-3 py-1.5 text-right">Цена</th>
            <th class="py-1.5 pl-3 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in openedReceipt.items ?? []" :key="i.id" class="border-t border-slate-200 dark:border-slate-800">
            <td class="py-1.5 pr-3">{{ i.product?.name ?? '—' }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ qty(i.quantity) }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ rawPrice(i.price, i.currency) }} {{ i.currency }}</td>
            <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap">{{ money(i.total, i.currency) }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="btn-ghost" @click="openedReceipt = null">Закрыть</button>
      </template>
    </ModalDialog>

    <ModalDialog
      v-if="openedPayment"
      :title="openedPayment.number"
      :subtitle="date(openedPayment.docDate) + (accountLabel(openedPayment) !== '—' ? ' · ' + accountLabel(openedPayment) : '')"
      @close="openedPayment = null"
    >
      <div class="mb-3 flex items-center justify-between">
        <span class="tabnum text-lg font-semibold text-slate-800 dark:text-slate-100">{{ money(openedPayment.amount, openedPayment.currency) }}</span>
        <span class="badge" :class="STATUS[openedPayment.status].cls">{{ STATUS[openedPayment.status].label }}</span>
      </div>

      <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Распределение по приходам</div>
      <EmptyState v-if="!openedAllocations.length" icon="wallet" title="Распределений нет" />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[440px] text-sm">
          <thead>
            <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
              <th class="py-1.5 pr-3">Приход</th>
              <th class="px-3 py-1.5">Валюта</th>
              <th class="px-3 py-1.5 text-right">Курс</th>
              <th class="px-3 py-1.5 text-right">Списано</th>
              <th class="py-1.5 pl-3 text-right">Закрыто</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in openedAllocations" :key="a.id" class="border-t border-slate-200 dark:border-slate-800">
              <td class="py-1.5 pr-3">
                <button class="font-medium text-indigo-600 hover:underline dark:text-indigo-400" @click="openReceiptFromAllocation(a)">
                  {{ receiptNumber(a.receipt) }}
                </button>
              </td>
              <td class="px-3 py-1.5 text-slate-500 dark:text-slate-400">{{ a.currency }}</td>
              <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap text-slate-500 dark:text-slate-400">{{ a.payRate ? rateFmt(a.payRate) : '—' }}</td>
              <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ money(a.amountSpent, openedPayment.currency) }}</td>
              <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap font-medium">{{ money(a.amountClosed, a.currency) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <button class="btn-ghost" @click="openedPayment = null">Закрыть</button>
        <button
          v-if="openedPayment.status === 'posted' && auth.can('supplierPayments.create')"
          class="btn-danger"
          :disabled="cancelling"
          @click="cancelPayment(openedPayment)"
        >
          Отменить оплату
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
