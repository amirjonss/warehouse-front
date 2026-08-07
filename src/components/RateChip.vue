<script setup>
import { onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { exchangeRates } from '@/api/resources'

const auth = useAuthStore()
const latest = ref(null)

onMounted(async () => {
  try {
    const rows = await exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 })
    latest.value = rows[0] ?? null
  } catch {
    latest.value = null
  }
})
</script>

<template>
  <RouterLink
    v-if="latest"
    :to="auth.can('exchangeRates') ? '/exchange-rates' : ''"
    class="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabnum text-slate-600 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
    title="Справочный курс дня — не пересчитывает суммы автоматически"
  >
    <span class="text-slate-400 dark:text-slate-500">курс</span>
    <span class="font-semibold text-slate-800 dark:text-slate-100">{{ Number(latest.rateBuy).toLocaleString('ru-RU') }}</span>
    <span class="text-slate-400 dark:text-slate-500">/</span>
    <span class="font-semibold text-slate-800 dark:text-slate-100">{{ Number(latest.rateSell).toLocaleString('ru-RU') }}</span>
  </RouterLink>
</template>
