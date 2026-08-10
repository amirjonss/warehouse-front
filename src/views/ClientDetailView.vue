<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date, money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { clients, debts, paymentAllocations, payments, sales, changePaymentStatus } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirmStore = useConfirmStore()

const client = ref(null)
const clientSales = ref([])
const clientPayments = ref([])
const debtRows = ref([])
const loading = ref(true)
const error = ref('')
const tab = ref('sales')

const openedPayment = ref(null)
const openedAllocations = ref([])
const cancelling = ref(false)

const METHOD = { cash: 'наличные', card: 'карта', transfer: 'перевод' }
const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [c, mySales, allPayments] = await Promise.all([
      clients.get(route.params.id),
      sales.list({ customer: route.params.id, 'order[docDate]': 'desc', 'order[id]': 'desc' }),
      payments.list(),
    ])
    client.value = c
    clientSales.value = mySales
    clientPayments.value = allPayments
      .filter((p) => idFromIri(p.client) === String(route.params.id))
      .sort((a, b) => b.docDate.localeCompare(a.docDate))

    // У Debt нет фильтра по client — берём точечно по каждой продаже клиента, а не всю таблицу долгов.
    const debtsPerSale = await Promise.all(mySales.map((s) => debts.list({ sale: s.id })))
    debtRows.value = debtsPerSale.flat()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

function saleRemaining(sale) {
  const rows = debtRows.value.filter((d) => idFromIri(d.sale) === String(sale.id))
  const usd = rows.filter((d) => d.currency === 'USD').reduce((s, d) => s + Number(d.amount), 0)
  const uzs = rows.filter((d) => d.currency === 'UZS').reduce((s, d) => s + Number(d.amount), 0)
  return { usd, uzs }
}

const balance = computed(() => {
  const usd = debtRows.value.filter((d) => d.currency === 'USD').reduce((s, d) => s + Number(d.amount), 0)
  const uzs = debtRows.value.filter((d) => d.currency === 'UZS').reduce((s, d) => s + Number(d.amount), 0)
  return { usd, uzs }
})

/** Удалить можно только черновик — проведённый платёж уже закрыл долг по накладным. */
async function removePaymentDraft(p) {
  if (!(await confirmStore.ask(`Удалить черновик «${p.number}»?`))) return
  try {
    await payments.remove(p.id)
    clientPayments.value = clientPayments.value.filter((x) => x.id !== p.id)
  } catch (e) {
    error.value = e.message
  }
}

/** Черновик открывается на продолжение, проведённый/отменённый — в режиме просмотра с распределением. */
async function openPayment(p) {
  if (p.status === 'draft') {
    router.push(`/clients/${route.params.id}/payment/${p.id}/edit`)
    return
  }
  openedPayment.value = p
  try {
    openedAllocations.value = await paymentAllocations.list({ payment: p.id })
  } catch (e) {
    error.value = e.message
  }
}

const saleNumber = (v) => clientSales.value.find((s) => String(s.id) === String(idFromIri(v)))?.number ?? '—'

/** Отмена платежа возвращает долг по накладным — перезагружаем список продаж/оплат, а не только статус. */
async function cancelPayment(p) {
  if (!(await confirmStore.ask(`Отменить платёж «${p.number}»?`))) return
  cancelling.value = true
  try {
    await changePaymentStatus(p.id, 'cancelled')
    openedPayment.value = null
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
  <p v-else-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
  <div v-else-if="client" class="space-y-4">
    <div class="flex items-center justify-between">
      <button class="btn-ghost btn-sm" @click="router.back()">
        <AppIcon name="chevronLeft" :size="16" /> Назад
      </button>
      <RouterLink v-if="auth.can('payments.create')" :to="`/clients/${route.params.id}/payment/new`" class="btn-primary btn-sm">
        <AppIcon name="plus" :size="16" /> Принять оплату
      </RouterLink>
    </div>

    <div class="card-pad">
      <div class="flex items-center gap-2">
        <div class="text-lg font-semibold text-slate-800 dark:text-slate-100">{{ client.name }}</div>
        <span v-if="!client.isActive" class="badge bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">не активен</span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
        <span v-if="client.contact">{{ client.contact }}</span>
        <span v-if="client.phone" class="flex items-center gap-1"><AppIcon name="phone" :size="14" />{{ client.phone }}</span>
        <span v-if="client.address" class="flex items-center gap-1"><AppIcon name="pin" :size="14" />{{ client.address }}</span>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Продаж</div>
        <div class="mt-1 text-lg font-semibold">{{ clientSales.length }}</div>
      </div>
      <div class="card-pad sm:col-span-2">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг</div>
        <div class="mt-1 tabnum text-lg font-semibold" :class="balance.usd > 0 || balance.uzs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
          <template v-if="balance.usd > 0">{{ money(balance.usd, 'USD') }}</template>
          <template v-if="balance.usd > 0 && balance.uzs > 0"> + </template>
          <template v-if="balance.uzs > 0">{{ money(balance.uzs, 'UZS') }}</template>
          <template v-if="balance.usd <= 0 && balance.uzs <= 0">рассчитался</template>
        </div>
      </div>
    </div>

    <div class="flex gap-2 border-b border-slate-200 dark:border-slate-800">
      <button class="px-3 py-2 text-sm font-medium" :class="tab === 'sales' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'sales'">
        Продажи
      </button>
      <button class="px-3 py-2 text-sm font-medium" :class="tab === 'pay' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'pay'">
        Оплаты
      </button>
    </div>

    <div v-if="tab === 'sales'" class="card overflow-hidden">
      <div v-if="clientSales.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div v-for="s in clientSales" :key="s.id" class="p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ s.number }}</div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ date(s.docDate) }}</div>
            </div>
            <span class="badge shrink-0" :class="STATUS[s.status].cls">{{ STATUS[s.status].label }}</span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="tabnum text-slate-700 dark:text-slate-300">
              <template v-if="Number(s.totalUsd) > 0">{{ money(s.totalUsd, 'USD') }}</template>
              <template v-if="Number(s.totalUsd) > 0 && Number(s.totalUzs) > 0"> + </template>
              <template v-if="Number(s.totalUzs) > 0">{{ money(s.totalUzs, 'UZS') }}</template>
            </span>
            <span class="tabnum text-amber-600 dark:text-amber-400">
              <template v-if="saleRemaining(s).usd > 0">{{ money(saleRemaining(s).usd, 'USD') }} </template>
              <template v-if="saleRemaining(s).uzs > 0">{{ money(saleRemaining(s).uzs, 'UZS') }}</template>
            </span>
          </div>
        </div>
      </div>

      <table v-if="clientSales.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Накладная</th>
            <th class="th">Дата</th>
            <th class="th">Сумма</th>
            <th class="th">Долг</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in clientSales" :key="s.id" class="table-row">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ s.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(s.docDate) }}</td>
            <td class="td tabnum">
              <template v-if="Number(s.totalUsd) > 0">{{ money(s.totalUsd, 'USD') }}</template>
              <template v-if="Number(s.totalUsd) > 0 && Number(s.totalUzs) > 0"><br /></template>
              <template v-if="Number(s.totalUzs) > 0">{{ money(s.totalUzs, 'UZS') }}</template>
            </td>
            <td class="td tabnum text-amber-600 dark:text-amber-400">
              <template v-if="saleRemaining(s).usd > 0">{{ money(saleRemaining(s).usd, 'USD') }}</template>
              <template v-if="saleRemaining(s).uzs > 0"><br />{{ money(saleRemaining(s).uzs, 'UZS') }}</template>
              <template v-if="saleRemaining(s).usd <= 0 && saleRemaining(s).uzs <= 0">—</template>
            </td>
            <td class="td"><span class="badge" :class="STATUS[s.status].cls">{{ STATUS[s.status].label }}</span></td>
            <td class="td text-right">
              <RouterLink :to="`/print/sale/${s.id}`" target="_blank" class="btn-ghost btn-sm"><AppIcon name="print" :size="14" /></RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="cart" title="Продаж пока нет" />
    </div>

    <div v-else class="card overflow-hidden">
      <div v-if="clientPayments.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div
          v-for="p in clientPayments"
          :key="p.id"
          class="cursor-pointer p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
          @click="openPayment(p)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ p.number }}</div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ date(p.docDate) }} · {{ METHOD[p.method] ?? p.method }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="badge" :class="STATUS[p.status].cls">{{ STATUS[p.status].label }}</span>
              <button
                v-if="p.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removePaymentDraft(p)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-2 tabnum text-sm text-emerald-600 dark:text-emerald-400">{{ money(p.amount, p.currency) }}</div>
        </div>
      </div>

      <table v-if="clientPayments.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Документ</th>
            <th class="th">Дата</th>
            <th class="th">Сумма</th>
            <th class="th">Способ</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in clientPayments"
            :key="p.id"
            class="table-row cursor-pointer"
            @click="openPayment(p)"
          >
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ p.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(p.docDate) }}</td>
            <td class="td tabnum text-emerald-600 dark:text-emerald-400">{{ money(p.amount, p.currency) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ METHOD[p.method] ?? p.method }}</td>
            <td class="td"><span class="badge" :class="STATUS[p.status].cls">{{ STATUS[p.status].label }}</span></td>
            <td class="td text-right">
              <button
                v-if="p.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removePaymentDraft(p)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="wallet" title="Оплат пока нет" />
    </div>

    <ModalDialog
      v-if="openedPayment"
      :title="openedPayment.number"
      :subtitle="date(openedPayment.docDate) + ' · ' + (METHOD[openedPayment.method] ?? openedPayment.method)"
      @close="openedPayment = null"
    >
      <div class="mb-3 flex items-center justify-between">
        <span class="tabnum text-lg font-semibold text-slate-800 dark:text-slate-100">{{ money(openedPayment.amount, openedPayment.currency) }}</span>
        <span class="badge" :class="STATUS[openedPayment.status].cls">{{ STATUS[openedPayment.status].label }}</span>
      </div>

      <div class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Распределение по накладным</div>
      <EmptyState v-if="!openedAllocations.length" icon="wallet" title="Распределений нет" />
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="py-1.5 pr-3">Накладная</th>
            <th class="px-3 py-1.5 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in openedAllocations" :key="a.id" class="border-t border-slate-100 dark:border-slate-800">
            <td class="py-1.5 pr-3">{{ saleNumber(a.sale) }}</td>
            <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap">{{ money(a.amountClosed, a.currency) }}</td>
          </tr>
        </tbody>
      </table>

      <template #footer>
        <button class="btn-ghost" @click="openedPayment = null">Закрыть</button>
        <button
          v-if="openedPayment.status === 'posted' && auth.can('payments.create')"
          class="btn-danger"
          :disabled="cancelling"
          @click="cancelPayment(openedPayment)"
        >
          Отменить платёж
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
