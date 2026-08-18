import { ref } from 'vue'
import { defineStore } from 'pinia'
import { exchangeRates } from '@/api/resources'

/**
 * Последний курс — общее состояние для чипа в шапке и страницы «Курсы валют».
 * Раньше чип грузил курс один раз при старте приложения и не знал о новых
 * записях, добавленных без перезагрузки страницы. Теперь оба места читают
 * один и тот же стор, и refresh() после создания/правки/удаления курса
 * обновляет чип сразу же.
 */
export const useExchangeRateStore = defineStore('exchangeRate', () => {
  const latest = ref(null)

  async function refresh() {
    try {
      const rows = await exchangeRates.list({ 'order[createdAt]': 'desc', itemsPerPage: 1 })
      latest.value = rows[0] ?? null
    } catch {
      latest.value = null
    }
  }

  return { latest, refresh }
})
