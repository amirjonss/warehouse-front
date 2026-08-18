<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useExchangeRateStore } from '@/stores/exchangeRate'

const auth = useAuthStore()
const rateStore = useExchangeRateStore()

onMounted(() => {
  if (!rateStore.latest) rateStore.refresh()
})
</script>

<template>
  <RouterLink
    v-if="rateStore.latest"
    :to="auth.can('exchangeRates') ? '/exchange-rates' : ''"
    class="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs tabnum text-slate-600 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
    title="Справочный курс дня — не пересчитывает суммы автоматически"
  >
    <span class="text-slate-400 dark:text-slate-500">курс</span>
    <span class="font-semibold text-slate-800 dark:text-slate-100">{{ Number(rateStore.latest.rateBuy).toLocaleString('ru-RU') }}</span>
    <span class="text-slate-400 dark:text-slate-500">/</span>
    <span class="font-semibold text-slate-800 dark:text-slate-100">{{ Number(rateStore.latest.rateSell).toLocaleString('ru-RU') }}</span>
  </RouterLink>
</template>
