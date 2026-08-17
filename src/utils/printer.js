import { registerPlugin, Capacitor } from '@capacitor/core'

// Сборщики чеков вынесены в receipt.js (без Capacitor), чтобы их можно было
// использовать и вне приложения (например, в scripts/test-print.mjs).
export { buildTestReceipt, buildSaleReceipt } from './receipt.js'

/**
 * Мост к нативному Android-плагину (см. ThermalPrinterPlugin.java).
 * Отправляет сырые ESC/POS байты на сетевой чек-принтер по TCP.
 */
const ThermalPrinter = registerPlugin('ThermalPrinter')

/** Есть ли десктопный (Electron) мост печати. */
function isElectron() {
  return typeof window !== 'undefined' && window.electronPrinter?.isElectron === true
}

/** Печать доступна в приложении (Android или десктоп), но не в обычном браузере. */
export function canPrint() {
  return Capacitor.isNativePlatform() || isElectron()
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
  if (!ip) {
    throw new Error('Не указан IP принтера (Настройки → Принтер)')
  }
  const dataBase64 = toBase64(bytes)
  if (isElectron()) {
    return window.electronPrinter.print({ ip, port: Number(port), dataBase64 })
  }
  if (Capacitor.isNativePlatform()) {
    return ThermalPrinter.print({ ip, port: Number(port), data: dataBase64 })
  }
  throw new Error('Печать доступна только в приложении (десктоп или Android)')
}
