<script setup>
/**
 * Что мы должны поставщикам. Зеркало «Долгов клиентов»: остаток живёт на
 * карточке поставщика (debtUsd / debtUzs), журнал — в supplier_debts.
 */
import { computed, onMounted, ref, watch } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import Pagination from '@/components/Pagination.vue'
import Spinner from '@/components/Spinner.vue'
import { dualMoney, money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { suppliers } from '@/api/resources'

const auth = useAuthStore()

const loading = ref(true)
const error = ref('')
const search = ref('')
const list = ref([])

const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => debouncedSearch.value.trim().toLowerCase())

const page = ref(1)
const pageSize = 20

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await suppliers.list({ hasDebt: true, 'order[debtUsd]': 'desc' })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() => {
  if (!searchQuery.value) return list.value
  return list.value.filter((s) =>
    `${s.name} ${s.contact ?? ''} ${s.phone ?? ''}`.toLowerCase().includes(searchQuery.value),
  )
})

const summary = computed(() => {
  const acc = { count: filtered.value.length, usd: 0, uzs: 0 }
  for (const s of list.value) {
    acc.usd += Number(s.debtUsd) || 0
    acc.uzs += Number(s.debtUzs) || 0
  }
  acc.count = list.value.length
  return acc
})
const rowsTotalItems = computed(() => filtered.value.length)
const rowsTotalPages = computed(() => Math.max(1, Math.ceil(rowsTotalItems.value / pageSize)))
const rows = computed(() => {
  const start = (page.value - 1) * pageSize
  return filtered.value.slice(start, start + pageSize)
})

watch(searchQuery, () => {
  page.value = 1
})

function hasDebt(s) {
  return Number(s.debtUsd) > 0 || Number(s.debtUzs) > 0
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-3 gap-2 sm:gap-3">
      <div class="min-w-0 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
        <div class="text-xs text-slate-500 dark:text-slate-400">Поставщиков</div>
        <div class="mt-1 text-base font-semibold sm:text-lg">{{ summary.count }}</div>
      </div>
      <div class="min-w-0 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, $</div>
        <div class="tabnum mt-1 text-base font-semibold break-words text-amber-600 sm:text-lg dark:text-amber-400">{{ money(summary.usd, 'USD') }}</div>
      </div>
      <div class="min-w-0 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, сум</div>
        <div class="tabnum mt-1 text-base font-semibold break-words text-amber-600 sm:text-lg dark:text-amber-400">{{ money(summary.uzs, 'UZS') }}</div>
      </div>
    </div>

    <input v-model="search" class="input w-full sm:max-w-xs" placeholder="Поиск по поставщику" />

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !rows.length" />

      <div v-if="rows.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="s in rows" :key="s.id" class="flex items-center justify-between gap-2 p-4">
          <div class="min-w-0">
            <RouterLink :to="`/suppliers/${s.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">
              {{ s.name }}
            </RouterLink>
            <div v-if="s.phone" class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{{ s.phone }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <div class="tabnum text-right text-sm text-amber-600 dark:text-amber-400">{{ dualMoney(s.debtUsd, s.debtUzs) }}</div>
            <RouterLink v-if="auth.can('supplierPayments.create') && hasDebt(s)" :to="`/suppliers/${s.id}/payment/new`" class="btn-ghost btn-sm">Оплата</RouterLink>
          </div>
        </div>
      </div>

      <table v-if="rows.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Поставщик</th>
            <th class="th">Телефон</th>
            <th class="th">Долг, $</th>
            <th class="th">Долг, сум</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in rows" :key="s.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/suppliers/${s.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">{{ s.name }}</RouterLink>
            </td>
            <td class="td text-slate-500 dark:text-slate-400">
              <a v-if="s.phone" :href="`tel:${s.phone}`" class="hover:text-indigo-600">{{ s.phone }}</a>
              <span v-else class="text-slate-300 dark:text-slate-600">—</span>
            </td>
            <td class="td tabnum" :class="Number(s.debtUsd) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'">
              {{ Number(s.debtUsd) > 0 ? money(s.debtUsd, 'USD') : '—' }}
            </td>
            <td class="td tabnum" :class="Number(s.debtUzs) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'">
              {{ Number(s.debtUzs) > 0 ? money(s.debtUzs, 'UZS') : '—' }}
            </td>
            <td class="td text-right">
              <RouterLink v-if="auth.can('supplierPayments.create') && hasDebt(s)" :to="`/suppliers/${s.id}/payment/new`" class="btn-ghost btn-sm">
                Оплата
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading && rowsTotalItems === 0" icon="truck" title="Долгов поставщикам нет" text="Все приходы оплачены" />

      <Pagination :page="page" :total-pages="rowsTotalPages" :total-items="rowsTotalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>
  </div>
</template>
