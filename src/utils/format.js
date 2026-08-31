/** Форматирование под демо: деньги в двух валютах, даты, количества. */

const MS_DAY = 86_400_000

/**
 * Валюта учёта — сум. Все итоги и отчёты приводятся к ней.
 * Доллар живёт как валюта цены и валюта долга, но не как валюта отчётности.
 */
export const BASE_CURRENCY = 'UZS'

export const CURRENCIES = {
  UZS: { code: 'UZS', suffix: 'сўм', decimals: 0, step: 1000 },
  USD: { code: 'USD', suffix: '$', decimals: 2, step: 0.5 },
}

export const currencyLabel = (code) => CURRENCIES[code]?.suffix ?? code

/**
 * money(1250000)                          → '1 250 000 сўм'
 * money(43.5, 'USD')                      → '43,50 $'
 * money(1250000, { withCurrency: false }) → '1 250 000'
 *
 * Второй аргумент принимает и код валюты, и объект опций: в большинстве мест
 * валюта — сум, и указывать её каждый раз было бы шумом.
 */
export function money(value, currency = BASE_CURRENCY, options = {}) {
  if (typeof currency === 'object' && currency !== null) {
    options = currency
    currency = BASE_CURRENCY
  }
  const { withCurrency = true } = options
  const cur = CURRENCIES[currency] ?? CURRENCIES[BASE_CURRENCY]
  const n = Number(value) || 0
  const s = n.toLocaleString('ru-RU', {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  })
  return withCurrency ? `${s} ${cur.suffix}` : s
}

/**
 * Разрядные пробелы только для сум — доллары показываем как есть (raw из API),
 * их формат по цифрам после запятой не трогаем.
 */
export function rawPrice(value, currency) {
  return currency === 'UZS' ? money(value, 'UZS', { withCurrency: false }) : value
}

/** Как rawPrice, но незаданная цена — всегда «—», а не «0» в одной валюте и «—» в другой. */
export function priceOrDash(value, currency) {
  return value === null || value === undefined || value === '' ? '—' : rawPrice(value, currency)
}

/** «Имя Ф.» — фамилия только первой буквой с точкой; без фамилии — просто имя. */
export function userName(u) {
  if (!u) return '—'
  const first = u.firstName ?? ''
  const last = u.lastName ? `${u.lastName.charAt(0).toUpperCase()}.` : ''
  return [first, last].filter(Boolean).join(' ') || '—'
}

/** Короткая запись для плиток: 12,4 млн / 4,4 тыс $ */
export function moneyShort(value, currency = BASE_CURRENCY) {
  const n = Number(value) || 0
  const tail = currency === BASE_CURRENCY ? '' : ` ${currencyLabel(currency)}`
  // «173 млн» читается лучше, чем «173,0 млн» — ноль после запятой не нужен
  const dec = (x) => (Number.isInteger(+x.toFixed(1)) ? String(Math.round(x)) : x.toFixed(1).replace('.', ','))
  if (Math.abs(n) >= 1_000_000_000) return `${dec(n / 1_000_000_000)} млрд${tail}`
  if (Math.abs(n) >= 1_000_000) return `${dec(n / 1_000_000)} млн${tail}`
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)} тыс${tail}`
  return money(n, currency)
}

/**
 * Пара валют для плиток: доллар главной строкой, сум — подписью. Складывать их
 * без курса нельзя, поэтому показываем два числа, а не одно.
 *
 * dualLabel(0, 1250000)  → { primary: '1 250 000 сўм', secondary: '' }
 * dualLabel(43.5, 12000) → { primary: '43,50 $', secondary: '12 000 сўм' }
 */
export function dualLabel(usd, uzs) {
  const u = Number(usd) || 0
  const s = Number(uzs) || 0
  if (u && s) return { primary: money(u, 'USD'), secondary: money(s, 'UZS') }
  if (u) return { primary: money(u, 'USD'), secondary: '' }
  return { primary: money(s, 'UZS'), secondary: '' }
}

/** Одна строка из двух валют: «43,50 $ + 12 000 сўм». Если оба нули — `empty`. */
export function dualMoney(usd, uzs, empty = '—') {
  const u = Number(usd) || 0
  const s = Number(uzs) || 0
  const parts = []
  if (u) parts.push(money(u, 'USD'))
  if (s) parts.push(money(s, 'UZS'))
  return parts.join(' + ') || empty
}

/** Округление по правилам валюты: сум — до целого, доллар — до цента. */
export function roundMoney(value, currency = BASE_CURRENCY) {
  const dec = CURRENCIES[currency]?.decimals ?? 0
  const k = 10 ** dec
  return Math.round((Number(value) || 0) * k) / k
}

/** Количество: до 2 знаков, но без лишних нулей. */
export function qty(value) {
  const n = Number(value) || 0
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return s.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Курс валюты: до 4 знаков после точки, но без лишних нулей (13000.0000 -> «13 000»). */
export function rateFmt(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value) || 0
  const s = Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return s.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export const UNITS = {
  pcs: { short: 'шт', full: 'штука' },
  kg: { short: 'кг', full: 'килограмм' },
  l: { short: 'л', full: 'литр' },
}

export function unitLabel(unit) {
  return UNITS[unit]?.short ?? unit
}

/** '2026-07-26' -> '26.07.2026' */
export function date(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** '26 июл' — для осей графиков */
export function dateShort(value) {
  const d = value instanceof Date ? value : new Date(value)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

export function dateTime(value) {
  const d = value instanceof Date ? value : new Date(value)
  return `${date(d)} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

export function toISODate(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toISOString().slice(0, 10)
}

export function addDays(d, days) {
  const dt = d instanceof Date ? new Date(d) : new Date(d)
  dt.setDate(dt.getDate() + days)
  return dt
}

/** Сколько дней осталось до даты (может быть отрицательным). */
export function daysLeft(isoDate, from = new Date()) {
  const a = new Date(isoDate)
  a.setHours(0, 0, 0, 0)
  const b = new Date(from)
  b.setHours(0, 0, 0, 0)
  return Math.round((a - b) / MS_DAY)
}

/** Статус остатка относительно минимума. */
export function stockStatus(stock, minStock) {
  if (stock <= 0) return { key: 'out', label: 'Нет в наличии', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' }
  if (stock <= minStock) return { key: 'low', label: 'Мало', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' }
  return { key: 'ok', label: 'В наличии', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' }
}

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

/** «Мясные консервы» -> 'myasnye-konservy' — генерируем slug из названия, не спрашивая пользователя. */
export function slugify(value) {
  const transliterated = (value ?? '')
    .toLowerCase()
    .split('')
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('')
  return transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function pluralRu(n, forms) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}
