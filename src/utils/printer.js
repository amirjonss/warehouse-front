import { registerPlugin, Capacitor } from '@capacitor/core'
import EscPosEncoder from 'esc-pos-encoder'

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

/** Строка «слева ... справа» по ширине чека (name слева, value справа). */
function twoCols(left, right, width) {
  left = String(left)
  right = String(right)
  const space = width - left.length - right.length
  if (space >= 1) return left + ' '.repeat(space) + right
  // не влезло — обрежем левую часть
  const cut = Math.max(0, width - right.length - 1)
  return left.slice(0, cut) + ' ' + right
}

const DIV = (width) => '-'.repeat(width)

/**
 * Тестовый чек — для проверки связи с принтером из настроек.
 */
export function buildTestReceipt(width = 48) {
  const enc = new EscPosEncoder()
  return enc
    .initialize()
    .codepage('cp866')
    .align('center')
    .bold(true)
    .line('WIREHOUSE')
    .bold(false)
    .line('Тестовая печать')
    .align('left')
    .line(DIV(width))
    .line(twoCols('Дата', new Date().toLocaleString('ru-RU'), width))
    .line('Связь с принтером: OK')
    .line(DIV(width))
    .newline()
    .newline()
    .cut()
    .encode()
}

/**
 * Чек продажи 80мм.
 * @param {{
 *   number:string, dateStr:string, customer:string, seller:string,
 *   items:Array<{name:string, qty:string, price:string, total:string}>,
 *   totals:Array<{label:string, value:string}>,
 *   paid:string, debt:string, width?:number
 * }} data
 */
export function buildSaleReceipt(data) {
  const width = data.width ?? 48
  const enc = new EscPosEncoder()
  enc.initialize().codepage('cp866')

  enc.align('center').bold(true).line('Оптовый склад «WIREHOUSE»').bold(false)
  enc.line('г. Ташкент, ул. Складская 1')
  enc.line('тел. +998 71 200-10-10')
  enc.align('left').line(DIV(width))

  enc.line(twoCols(`Чек № ${data.number}`, data.dateStr, width))
  if (data.customer) enc.line(`Покупатель: ${data.customer}`)
  enc.line(DIV(width))

  for (const it of data.items) {
    enc.line(it.name)
    enc.line(twoCols(`  ${it.qty} x ${it.price}`, it.total, width))
  }

  enc.line(DIV(width))
  enc.bold(true)
  for (const t of data.totals) enc.line(twoCols(t.label, t.value, width))
  enc.bold(false)

  if (data.paid) enc.line(twoCols('Оплачено', data.paid, width))
  if (data.debt) enc.line(twoCols('Задолженность', data.debt, width))

  enc.line(DIV(width))
  if (data.seller) enc.line(`Продавец: ${data.seller}`)
  enc.align('center').newline().line('Спасибо за покупку!').newline().newline()
  enc.cut()
  return enc.encode()
}
