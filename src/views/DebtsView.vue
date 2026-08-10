<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import Pagination from '@/components/Pagination.vue'
import { money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'
import { clientDebtSummary } from '@/api/resources'

const auth = useAuthStore()

const loading = ref(true)
const error = ref('')
const search = ref('')

/** Три плитки сверху — один агрегатный запрос (SUM/COUNT на бэкенде), не сумма по всем клиентам на клиенте. */
const summary = ref({ count: 0, totalDebtUsd: '0', totalDebtUzs: '0' })
async function loadSummary() {
  try {
    summary.value = await clientDebtSummary()
  } catch (e) {
    error.value = e.message
  }
}

/** Поиск уходит на бэкенд (?name=...) только от 2 символов и с задержкой. */
const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => {
  const s = debouncedSearch.value.trim()
  return s.length >= 2 ? s : ''
})

const page = ref(1)
const pageSize = 20
const pageItems = ref([])
const totalItems = ref(0)

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, hasDebt: true, 'order[debtUsd]': 'desc' }
    if (searchQuery.value) params.name = searchQuery.value
    const { items, totalItems: total } = await api.getPage('/clients', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPage(1)
  loadSummary()
})

watch(searchQuery, () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Должников</div>
        <div class="mt-1 text-lg font-semibold">{{ summary.count }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, $</div>
        <div class="mt-1 tabnum text-lg font-semibold text-amber-600 dark:text-amber-400">{{ money(summary.totalDebtUsd, 'USD') }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, сум</div>
        <div class="mt-1 tabnum text-lg font-semibold text-amber-600 dark:text-amber-400">{{ money(summary.totalDebtUzs, 'UZS') }}</div>
      </div>
    </div>

    <input v-model="search" class="input w-full sm:max-w-xs" placeholder="Поиск по клиенту" />

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <div v-if="pageItems.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div v-for="d in pageItems" :key="d.id" class="flex items-center justify-between gap-2 p-4">
          <RouterLink :to="`/clients/${d.id}`" class="min-w-0 font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">
            {{ d.name }}
          </RouterLink>
          <div class="flex shrink-0 items-center gap-3">
            <div class="tabnum text-right text-sm">
              <div v-if="Number(d.debtUsd) > 0" class="text-amber-600 dark:text-amber-400">{{ money(d.debtUsd, 'USD') }}</div>
              <div v-if="Number(d.debtUzs) > 0" class="text-amber-600 dark:text-amber-400">{{ money(d.debtUzs, 'UZS') }}</div>
            </div>
            <RouterLink v-if="auth.can('payments.create')" :to="`/clients/${d.id}/payment/new`" class="btn-ghost btn-sm">Оплата</RouterLink>
          </div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Клиент</th>
            <th class="th">Долг, $</th>
            <th class="th">Долг, сум</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in pageItems" :key="d.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/clients/${d.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">{{ d.name }}</RouterLink>
            </td>
            <td class="td tabnum" :class="Number(d.debtUsd) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'">
              {{ Number(d.debtUsd) > 0 ? money(d.debtUsd, 'USD') : '—' }}
            </td>
            <td class="td tabnum" :class="Number(d.debtUzs) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'">
              {{ Number(d.debtUzs) > 0 ? money(d.debtUzs, 'UZS') : '—' }}
            </td>
            <td class="td text-right">
              <RouterLink v-if="auth.can('payments.create')" :to="`/clients/${d.id}/payment/new`" class="btn-ghost btn-sm">
                Оплата
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading && totalItems === 0" icon="wallet" title="Должников нет" text="Все клиенты рассчитались" />
      <EmptyState v-else-if="!loading" icon="wallet" title="Ничего не найдено на этой странице" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>
  </div>
</template>
