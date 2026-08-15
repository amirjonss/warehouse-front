import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'wirehouse-printer'

/**
 * Настройки сетевого чек-принтера (XPrinter 80mm и совместимые).
 * Принтер подключён к роутеру по кабелю и получает IP; устройство печатает
 * на него по TCP-сокету (порт 9100) — см. src/utils/printer.js.
 */
export const usePrinterStore = defineStore('printer', () => {
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
  })()

  const ip = ref(saved.ip ?? '')
  const port = ref(saved.port ?? 9100)
  const width = ref(saved.width ?? 48) // символов в строке: 80mm ≈ 48, 58mm ≈ 32

  watch([ip, port, width], () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ip: ip.value, port: Number(port.value), width: Number(width.value) }),
    )
  })

  const configured = () => Boolean(ip.value)

  return { ip, port, width, configured }
})
