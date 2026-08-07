<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import PaymentFormModal from '@/components/PaymentFormModal.vue'
import { date, money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { clients, debts, payments, sales } from '@/api/resources'
import { idFromIri, iri } from '@/api/iri'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const client = ref(null)
const clientSales = ref([])
const clientPayments = ref([])
const debtRows = ref([])
const loading = ref(true)
const error = ref('')
const tab = ref('sales')
const payModal = ref(false)

const METHOD = { cash: 'наличные', card: 'карта', transfer: 'перевод' }
const STATUS = { draft: 'черновик', posted: 'проведено', cancelled: 'отменено' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const clientIri = iri('clients', route.params.id)
    const [c, allSales, allPayments, allDebts] = await Promise.all([
      clients.get(route.params.id),
      sales.list(),
      payments.list(),
      debts.list(),
    ])
    client.value = c
    clientSales.value = allSales
      .filter((s) => idFromIri(s.customer) === String(route.params.id))
      .sort((a, b) => b.docDate.localeCompare(a.docDate))
    clientPayments.value = allPayments
      .filter((p) => idFromIri(p.client) === String(route.params.id))
      .sort((a, b) => b.docDate.localeCompare(a.docDate))
    debtRows.value = allDebts.filter((d) => idFromIri(d.client) === String(route.params.id))
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
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
  <p v-else-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
  <div v-else-if="client" class="space-y-4">
    <div class="flex items-center justify-between">
      <button class="btn-ghost btn-sm" @click="router.back()">
        <AppIcon name="chevronLeft" :size="16" /> Назад
      </button>
      <button v-if="auth.can('payments.create')" class="btn-primary btn-sm" @click="payModal = true">
        <AppIcon name="plus" :size="16" /> Принять оплату
      </button>
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
        <div class="text-xs text-slate-500 dark:text-slate-400">Отгрузок</div>
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
        Отгрузки
      </button>
      <button class="px-3 py-2 text-sm font-medium" :class="tab === 'pay' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 dark:text-slate-400'" @click="tab = 'pay'">
        Оплаты
      </button>
    </div>

    <div v-if="tab === 'sales'" class="card overflow-hidden">
      <table v-if="clientSales.length" class="w-full">
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
            <td class="td"><span class="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{{ STATUS[s.status] }}</span></td>
            <td class="td text-right">
              <RouterLink :to="`/print/sale/${s.id}`" target="_blank" class="btn-ghost btn-sm"><AppIcon name="print" :size="14" /></RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="truck" title="Отгрузок пока нет" />
    </div>

    <div v-else class="card overflow-hidden">
      <table v-if="clientPayments.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Документ</th>
            <th class="th">Дата</th>
            <th class="th">Сумма</th>
            <th class="th">Способ</th>
            <th class="th">Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in clientPayments" :key="p.id" class="table-row">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ p.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(p.docDate) }}</td>
            <td class="td tabnum text-emerald-600 dark:text-emerald-400">{{ money(p.amount, p.currency) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ METHOD[p.method] ?? p.method }}</td>
            <td class="td"><span class="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{{ STATUS[p.status] }}</span></td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="wallet" title="Оплат пока нет" />
    </div>

    <PaymentFormModal
      v-if="payModal"
      :client-id="client.id"
      :client-name="client.name"
      @close="payModal = false"
      @saved="load"
    />
  </div>
</template>
