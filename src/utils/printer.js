import { registerPlugin, Capacitor } from '@capacitor/core'

// Сборщики чеков вынесены в receipt.js (без Capacitor), чтобы их можно было
// использовать и вне приложения (например, в scripts/test-print.mjs).
export { buildTestReceipt, buildSaleReceipt } from './receipt.js'

/**
 * Мост к нативному Android-плагину (см. ThermalPrinterPlugin.java).
 * Отправляет сырые ESC/POS байты на сетевой чек-принтер по TCP.
 */
const ThermalPrinter = registerPlugin('ThermalPrinter')

/** Печать возможна только внутри Android-приложения (в вебе нет raw-сокетов). */
export function canPrint() {
  return Capacitor.isNativePlatform()
}

/** Uint8Array → base64 (для передачи бинарных данных через мост Capacitor). */
function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * Отправить готовые ESC/POS байты на принтер.
 * @param {{ip:string, port?:number, bytes:Uint8Array}} p
 */
export async function printBytes({ ip, port = 9100, bytes }) {
  if (!canPrint()) {
    throw new Error('Печать доступна только в Android-приложении')
  }
  if (!ip) {
    throw new Error('Не указан IP принтера (Настройки → Принтер)')
  }
  return ThermalPrinter.print({ ip, port: Number(port), data: toBase64(bytes) })
}
