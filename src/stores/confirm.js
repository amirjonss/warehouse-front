import { reactive } from 'vue'
import { defineStore } from 'pinia'

/**
 * Единая замена window.confirm() — браузерный алерт не вписывается в дизайн
 * и не поддерживает тёмную тему. Любое место в приложении, которому нужно
 * подтверждение перед опасным действием, вызывает confirmStore.ask(...) и
 * ждёт промис; рендерится это через <ConfirmDialogHost>, смонтированный
 * один раз в App.vue.
 */
export const useConfirmStore = defineStore('confirm', () => {
  const state = reactive({
    isOpen: false,
    title: 'Подтвердите действие',
    message: '',
    confirmLabel: 'Удалить',
    cancelLabel: 'Отмена',
    danger: true,
  })

  let resolveFn = null

  function ask(message, options = {}) {
    state.message = message
    state.title = options.title ?? 'Подтвердите действие'
    state.confirmLabel = options.confirmLabel ?? 'Удалить'
    state.cancelLabel = options.cancelLabel ?? 'Отмена'
    state.danger = options.danger ?? true
    state.isOpen = true
    return new Promise((resolve) => {
      resolveFn = resolve
    })
  }

  function confirm() {
    state.isOpen = false
    resolveFn?.(true)
    resolveFn = null
  }

  function cancel() {
    state.isOpen = false
    resolveFn?.(false)
    resolveFn = null
  }

  return { state, ask, confirm, cancel }
})
