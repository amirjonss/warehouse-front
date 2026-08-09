import { computed, ref } from 'vue'

/** Локальная YYYY-MM-DD без сдвига по UTC (в отличие от toISOString). */
function localISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthRange(offset) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return [localISO(first), localISO(last)]
}

/**
 * Поля типа docDate на бэкенде — datetime, а не голая дата: строгое `before=2026-01-01`
 * фильтрует по 00:00:00 этого дня и режет все записи, заведённые позже полуночи.
 * Поэтому верхнюю границу для API-запроса всегда сдвигают на следующий день.
 */
export function dayAfter(v) {
  const [y, m, d] = v.split('-').map(Number)
  return localISO(new Date(y, m - 1, d + 1))
}

/** Симметричный сдвиг вниз — для strictly_after/strictly_before, где границы исключающие. */
export function dayBefore(v) {
  const [y, m, d] = v.split('-').map(Number)
  return localISO(new Date(y, m - 1, d - 1))
}

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_RU_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

/**
 * Фильтр «период»: месяц-навигация (сегодня/стрелки) + точная дата.
 * from/to — всегда включительный диапазон YYYY-MM-DD; для API-запроса верхнюю
 * границу нужно прогнать через dayAfter() (см. комментарий выше).
 */
export function useDateRangeFilter() {
  const monthOffset = ref(0) // 0 — текущий месяц, -1 — прошлый, +1 — следующий, и т.д.
  const specificDate = ref('')
  const from = ref('')
  const to = ref('')
  ;[from.value, to.value] = monthRange(0)

  const monthLabel = computed(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + monthOffset.value, 1)
    return `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
  })
  const monthLabelShort = computed(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + monthOffset.value, 1)
    return `${MONTHS_RU_SHORT[d.getMonth()]} ${d.getFullYear()}`
  })

  function applyMonth(offset) {
    monthOffset.value = offset
    specificDate.value = ''
    ;[from.value, to.value] = monthRange(offset)
  }
  const shiftMonth = (delta) => applyMonth(monthOffset.value + delta)

  /** Пустая дата — возврат к диапазону текущего выбранного месяца. */
  function applySpecificDate(v) {
    specificDate.value = v
    if (v) {
      from.value = v
      to.value = v
      const [y, m] = v.split('-').map(Number)
      const now = new Date()
      monthOffset.value = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())
    } else {
      ;[from.value, to.value] = monthRange(monthOffset.value)
    }
  }

  return { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate }
}
