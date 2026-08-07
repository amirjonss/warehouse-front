<script setup>
import { computed, onMounted, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import PaymentFormModal from '@/components/PaymentFormModal.vue'
import { money } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { clientDebt } from '@/api/resources'

const auth = useAuthStore()

const list = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const currencyFilter = ref('')
const payFor = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await clientDebt()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() =>
  list.value
    .filter((d) => Number(d.debtUsd) > 0 || Number(d.debtUzs) > 0)
    .filter((d) => !currencyFilter.value || Number(d[currencyFilter.value === 'USD' ? 'debtUsd' : 'debtUzs']) > 0)
    .filter((d) => d.name.toLowerCase().includes(search.value.toLowerCase()))
    .sort((a, b) => Number(b.debtUsd) + Number(b.debtUzs) / 1e6 - (Number(a.debtUsd) + Number(a.debtUzs) / 1e6)),
)

const totals = computed(() => ({
  usd: list.value.reduce((s, d) => s + Number(d.debtUsd), 0),
  uzs: list.value.reduce((s, d) => s + Number(d.debtUzs), 0),
  count: filtered.value.length,
}))
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Должников</div>
        <div class="mt-1 text-lg font-semibold">{{ totals.count }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, $</div>
        <div class="mt-1 tabnum text-lg font-semibold text-amber-600 dark:text-amber-400">{{ money(totals.usd, 'USD') }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Долг, сум</div>
        <div class="mt-1 tabnum text-lg font-semibold text-amber-600 dark:text-amber-400">{{ money(totals.uzs, 'UZS') }}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по клиенту" />
      <select v-model="currencyFilter" class="input max-w-[140px]">
        <option value="">Все валюты</option>
        <option value="USD">Доллар</option>
        <option value="UZS">Сум</option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <table v-if="filtered.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Клиент</th>
            <th class="th">Долг, $</th>
            <th class="th">Долг, сум</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filtered" :key="d.id" class="table-row">
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
              <button v-if="auth.can('payments.create')" class="btn-ghost btn-sm" @click="payFor = d">
                Оплата
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="wallet" title="Должников нет" text="Все клиенты рассчитались" />
    </div>

    <PaymentFormModal
      v-if="payFor"
      :client-id="payFor.id"
      :client-name="payFor.name"
      @close="payFor = null"
      @saved="load"
    />
  </div>
</template>
