import { ref, watch } from 'vue'

/** Debounced-копия source: обновляется через delay мс после того, как source перестал меняться. */
export function useDebouncedValue(source, delay = 300) {
  const debounced = ref(source.value)
  let timer = null
  watch(source, (val) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      debounced.value = val
    }, delay)
  })
  return debounced
}
