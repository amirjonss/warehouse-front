import { reactive } from 'vue'
import { defineStore } from 'pinia'

/**
 * Тосты об успехе — раньше провести документ значило «перекинуло на список»
 * без единого подтверждения. toastStore.success(...) кладёт сообщение
 * в очередь, <ToastHost> (смонтирован один раз в App.vue) рендерит стек
 * и сам убирает каждый тост через 3.5с.
 */
export const useToastStore = defineStore('toast', () => {
  const items = reactive([])
  let nextId = 1

  function push(message, type = 'success', timeout = 3500) {
    const id = nextId++
    items.push({ id, message, type })
    setTimeout(() => dismiss(id), timeout)
  }

  function dismiss(id) {
    const idx = items.findIndex((t) => t.id === id)
    if (idx !== -1) items.splice(idx, 1)
  }

  const success = (message) => push(message, 'success')

  return { items, success, dismiss }
})
