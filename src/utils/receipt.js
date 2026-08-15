import EscPosEncoder from 'esc-pos-encoder'

/**
 * Чистая сборка ESC/POS-чеков (без Capacitor) — используется и приложением
 * (src/utils/printer.js), и тестовым скриптом (scripts/test-print.mjs).
 */

/**
 * Приводит текст к «чистому» cp866: убирает символы, которых нет в этой
 * кодовой странице и которые ломают ширину/выглядят как «?» на чеке.
 *  - «ў/Ў» → «у/У» (нет в cp866, принтер считает как 2 знака → перенос строки)
 *  - «ёлочки» → обычные кавычки (в cp866 печатались как «?»)
 *  - неразрывные/узкие пробелы (из форматирования чисел) → обычный пробел
 */
export function sanitize(s) {
  return String(s)
    .replace(/[    ⁠]/g, ' ')
    .replace(/[«»]/g, '"')
    .replace(/ў/g, 'у')
    .replace(/Ў/g, 'У')
}

/** Строка «слева ... справа» по ширине чека. */
export function twoCols(left, right, width) {
  left = sanitize(left)
  right = sanitize(right)
  const space = width - left.length - right.length
  if (space >= 1) return left + ' '.repeat(space) + right
  const cut = Math.max(0, width - right.length - 1)
  return left.slice(0, cut) + ' ' + right
}

export const DIV = (width) => '-'.repeat(width)

/** Тестовый чек — для проверки связи с принтером. */
export function buildTestReceipt(width = 42) {
  return new EscPosEncoder()
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
  const width = data.width ?? 42
  const enc = new EscPosEncoder()
  enc.initialize().codepage('cp866')

  enc.align('center')
  enc.line('г. Самарканд, ул. Зарафшон шох')
  enc.line('тел. +998 95 096-15-10')
  enc.align('left').line(DIV(width))

  enc.line(twoCols(`Чек № ${data.number}`, data.dateStr, width))
  if (data.customer) enc.line(sanitize(`Покупатель: ${data.customer}`))
  enc.line(DIV(width))

  for (const it of data.items) {
    enc.line(sanitize(it.name))
    enc.line(twoCols(`  ${it.qty} x ${it.price}`, it.total, width))
    enc.newline() // пустая строка между позициями — для читаемости
  }

  enc.line(DIV(width))
  enc.bold(true)
  for (const t of data.totals) enc.line(twoCols(t.label, t.value, width))
  enc.bold(false)

  if (data.paid) enc.line(twoCols('Оплачено', data.paid, width))
  if (data.debt) enc.line(twoCols('Задолженность', data.debt, width))

  enc.line(DIV(width))
  if (data.seller) enc.line(sanitize(`Продавец: ${data.seller}`))
  enc.align('center').newline().line('Спасибо за покупку!').newline().newline()
  enc.cut()
  return enc.encode()
}
