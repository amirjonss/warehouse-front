import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'wirehouse-theme'

export const useThemeStore = defineStore('theme', () => {
  // index.html уже выставил класс до монтирования — здесь только читаем его,
  // чтобы стор и DOM не разошлись при первом рендере.
  const dark = ref(document.documentElement.classList.contains('dark'))

  watch(
    dark,
    (value) => {
      document.documentElement.classList.toggle('dark', value)
      localStorage.setItem(STORAGE_KEY, value ? 'dark' : 'light')
    },
    { immediate: false },
  )

  function toggle() {
    dark.value = !dark.value
  }

  return { dark, toggle }
})
