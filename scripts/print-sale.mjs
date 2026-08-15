#!/usr/bin/env node
/**
 * Печать РЕАЛЬНОЙ продажи из API на чек-принтер.
 * Использует тот же генератор чека, что и приложение (src/utils/receipt.js).
 *
 * Логин берётся из переменных окружения (чтобы не хранить пароль в файле):
 *   WH_EMAIL, WH_PASSWORD, [WH_API=http://localhost:8507/api]
 *
 * Запуск:
 *   WH_EMAIL=... WH_PASSWORD=... node scripts/print-sale.mjs [saleId] [printerIp]
 *   # без saleId печатается первая продажа со страницы; IP по умолчанию 192.168.100.100
 */
import net from 'node:net'
import { buildSaleReceipt } from '../src/utils/receipt.js'
import { money, qty, dateTime, userName } from '../src/utils/format.js'
import { idFromIri } from '../src/api/iri.js'

const API = process.env.WH_API || 'http://localhost:8507/api'
const EMAIL = process.env.WH_EMAIL
const PASSWORD = process.env.WH_PASSWORD
const saleIdArg = process.argv[2]
const printerIp = process.argv[3] || '192.168.100.100'
const printerPort = 9100

if (!EMAIL || !PASSWORD) {
  console.error('❌ Задайте WH_EMAIL и WH_PASSWORD в окружении')
  process.exit(1)
}

async function apiLogin() {
  const res = await fetch(`${API}/users/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Логин не удался: ${res.status} ${await res.text()}`)
  return (await res.json()).accessToken
}

async function apiGet(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/ld+json', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json()
}
const members = (d) => d?.member ?? d?.['hydra:member'] ?? []

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(5000)
    socket.on('timeout', () => { socket.destroy(); reject(new Error('таймаут принтера')) })
    socket.on('error', reject)
    socket.connect(printerPort, printerIp, () => {
      socket.write(Buffer.from(bytes), () => socket.end())
    })
    socket.on('close', () => resolve())
  })
}

// --- main ---
const token = await apiLogin()
console.log('✔ вход в API выполнен')

let sale
if (saleIdArg) {
  sale = await apiGet(token, `/sales/${saleIdArg}`)
} else {
  const list = members(await apiGet(token, '/sales?page=1'))
  sale = list[list.length - 1] // последняя на странице
  if (!sale) throw new Error('продажи не найдены')
}
console.log(`→ продажа ${sale.number} (id ${sale.id}), клиент: ${sale.customer?.name}`)

// Долги по этой продаже → остаток (rest); оплачено = итог − остаток
const allDebts = members(await apiGet(token, '/debts?page=1'))
const saleDebts = allDebts.filter((d) => String(idFromIri(d.sale)) === String(sale.id))
const rest = {
  USD: saleDebts.filter((d) => d.currency === 'USD').reduce((s, d) => s + Number(d.amount), 0),
  UZS: saleDebts.filter((d) => d.currency === 'UZS').reduce((s, d) => s + Number(d.amount), 0),
}
const paid = {
  USD: Math.max(0, Number(sale.totalUsd) - rest.USD),
  UZS: Math.max(0, Number(sale.totalUzs) - rest.UZS),
}

const totals = []
if (Number(sale.totalUsd) > 0) totals.push({ label: 'Итого $', value: money(sale.totalUsd, 'USD') })
if (Number(sale.totalUzs) > 0) totals.push({ label: 'Итого сум', value: money(sale.totalUzs, 'UZS') })

const paidParts = []
if (paid.USD) paidParts.push(money(paid.USD, 'USD'))
if (paid.UZS) paidParts.push(money(paid.UZS, 'UZS'))
const debtParts = []
if (rest.USD) debtParts.push(money(rest.USD, 'USD'))
if (rest.UZS) debtParts.push(money(rest.UZS, 'UZS'))

const bytes = buildSaleReceipt({
  number: sale.number,
  dateStr: dateTime(sale.createdAt ?? sale.docDate),
  customer: sale.customer?.name ?? '',
  seller: userName(sale.soldBy),
  items: (sale.items ?? []).map((i) => ({
    name: i.product?.name ?? '—',
    qty: qty(i.quantity),
    price: money(i.price, i.currency),
    total: money(i.total, i.currency),
  })),
  totals,
  paid: paidParts.join(' + '),
  debt: debtParts.join(' + '),
})

await sendToPrinter(bytes)
console.log(`✔ Чек продажи ${sale.number} отправлен на принтер ${printerIp}:${printerPort} (${bytes.length} байт)`)
