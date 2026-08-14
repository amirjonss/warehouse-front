<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { date, money, pluralRu, qty } from '@/utils/format'
import { clients, debts, products, saleItems, sales, users } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const route = useRoute()

const sale = ref(null)
const customer = ref(null)
const items = ref([])
const productList = ref([])
const soldByEmail = ref('')
const paid = ref({ USD: 0, UZS: 0 })
const rest = ref({ USD: 0, UZS: 0 })
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const [s, allItems, p] = await Promise.all([sales.get(route.params.id), saleItems.list(), products.list()])
    sale.value = s
    productList.value = p
    items.value = allItems.filter((i) => String(idFromIri(i.sale)) === String(route.params.id))

    const [c, allDebts, allUsers] = await Promise.all([
      clients.get(idFromIri(s.customer)),
      debts.list(),
      users.list().catch(() => []),
    ])
    customer.value = c
    const saleDebts = allDebts.filter((d) => String(idFromIri(d.sale)) === String(route.params.id))
    rest.value = {
      USD: saleDebts.filter((d) => d.currency === 'USD').reduce((sum, d) => sum + Number(d.amount), 0),
      UZS: saleDebts.filter((d) => d.currency === 'UZS').reduce((sum, d) => sum + Number(d.amount), 0),
    }
    paid.value = {
      USD: Math.max(0, Number(s.totalUsd) - rest.value.USD),
      UZS: Math.max(0, Number(s.totalUzs) - rest.value.UZS),
    }
    soldByEmail.value = allUsers.find((u) => String(u.id) === String(idFromIri(s.soldBy)))?.email ?? ''
  } catch {
    sale.value = null
  } finally {
    loading.value = false
  }
}
onMounted(load)

const totalQty = computed(() => items.value.reduce((s, i) => s + Number(i.quantity), 0))
const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'

const doPrint = () => window.print()
const doClose = () => window.close()

function amountInWords(value, currency = 'UZS') {
  const whole = Math.floor(Math.abs(value))
  const words = numberInWords(whole)
  if (currency === 'USD') {
    const cents = Math.round((Math.abs(value) - whole) * 100)
    const dollarWord = pluralRu(whole, ['доллар', 'доллара', 'долларов'])
    const centWord = pluralRu(cents, ['цент', 'цента', 'центов'])
    return `${words} ${dollarWord} ${String(cents).padStart(2, '0')} ${centWord}`
  }
  return `${words} сўм`
}

function numberInWords(n) {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const onesF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const teens = [
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
    'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
  ]
  const tens = [
    '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
    'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
  ]
  const hundreds = [
    '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
    'шестьсот', 'семьсот', 'восемьсот', 'девятьсот',
  ]

  function trio(num, female) {
    const out = []
    const h = Math.floor(num / 100)
    const t = Math.floor((num % 100) / 10)
    const o = num % 10
    if (h) out.push(hundreds[h])
    if (t === 1) out.push(teens[o])
    else {
      if (t) out.push(tens[t])
      if (o) out.push(female ? onesF[o] : ones[o])
    }
    return out.join(' ')
  }

  const value = Math.round(n)
  if (value === 0) return 'ноль'
  const groups = [
    { div: 1_000_000_000, forms: ['миллиард', 'миллиарда', 'миллиардов'], female: false },
    { div: 1_000_000, forms: ['миллион', 'миллиона', 'миллионов'], female: false },
    { div: 1_000, forms: ['тысяча', 'тысячи', 'тысяч'], female: true },
  ]
  let remainder = value
  const parts = []
  for (const g of groups) {
    const count = Math.floor(remainder / g.div)
    remainder %= g.div
    if (!count) continue
    const last = count % 10
    const last2 = count % 100
    const form = last2 > 10 && last2 < 20 ? g.forms[2] : last === 1 ? g.forms[0] : last > 1 && last < 5 ? g.forms[1] : g.forms[2]
    parts.push(`${trio(count, g.female)} ${form}`)
  }
  if (remainder) parts.push(trio(remainder, false))
  const s = parts.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
</script>

<template>
  <!--
    Накладная — печатный документ: должна выглядеть как бумага независимо от того,
    включена ли тёмная тема в приложении. Без dark:text-slate-900 на корне текст без
    собственного цвета наследует dark:text-slate-200 от <body> и становится нечитаемым
    на белом листе.
  -->
  <div v-if="loading" class="p-8 text-sm text-slate-500 dark:bg-slate-100">Загрузка…</div>
  <div v-else-if="sale" class="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8 dark:bg-slate-100 dark:text-slate-900">
    <div class="no-print mx-auto mb-4 flex max-w-3xl gap-2">
      <button class="btn-primary" @click="doPrint">
        <AppIcon name="print" :size="17" /> Печать
      </button>
      <button class="btn-ghost dark:border-slate-300 dark:bg-white dark:text-slate-700 dark:hover:bg-slate-50" @click="doClose">Закрыть</button>
    </div>

    <div class="print-area mx-auto max-w-3xl bg-white p-6 shadow-sm sm:p-10 dark:bg-white">
      <div class="flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div>
          <div class="text-lg font-bold text-slate-900">Оптовый склад «Wirehouse»</div>
          <div class="mt-1 text-xs text-slate-600">
            г. Ташкент, ул. Складская 1 · тел. +998 71 200-10-10<br />
            ИНН 300 000 000 · р/с 2020 8000 0000 0000 0001
          </div>
        </div>
        <div class="text-right">
          <div class="text-sm font-semibold text-slate-900">Товарная накладная</div>
          <div class="tabnum mt-1 text-xs text-slate-600">
            № {{ sale.number }}<br />от {{ date(sale.docDate) }}
          </div>
        </div>
      </div>

      <div class="mt-4 grid gap-4 text-xs sm:grid-cols-2">
        <div>
          <div class="font-semibold text-slate-500 uppercase">Поставщик</div>
          <div class="mt-1 text-slate-800">Оптовый склад «Wirehouse»</div>
          <div class="text-slate-600">г. Ташкент, ул. Складская 1</div>
        </div>
        <div>
          <div class="font-semibold text-slate-500 uppercase">Покупатель</div>
          <div class="mt-1 text-slate-800">{{ customer?.name }}</div>
          <div class="text-slate-600">{{ customer?.address }}</div>
          <div class="text-slate-600">{{ customer?.contact }} · {{ customer?.phone }}</div>
        </div>
      </div>

      <table class="mt-5 w-full border-collapse text-xs">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-300 px-2 py-1.5 text-left">№</th>
            <th class="border border-slate-300 px-2 py-1.5 text-left">Наименование товара</th>
            <th class="border border-slate-300 px-2 py-1.5 text-right">Кол-во</th>
            <th class="border border-slate-300 px-2 py-1.5 text-right">Цена</th>
            <th class="border border-slate-300 px-2 py-1.5 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(i, idx) in items" :key="i.id">
            <td class="tabnum border border-slate-300 px-2 py-1.5">{{ idx + 1 }}</td>
            <td class="border border-slate-300 px-2 py-1.5">{{ productName(i.product) }}</td>
            <td class="tabnum border border-slate-300 px-2 py-1.5 text-right">{{ qty(i.quantity) }}</td>
            <td class="tabnum border border-slate-300 px-2 py-1.5 text-right">{{ money(i.price, i.currency) }}</td>
            <td class="tabnum border border-slate-300 px-2 py-1.5 text-right font-semibold">{{ money(i.total, i.currency) }}</td>
          </tr>
          <tr v-if="Number(sale.totalUsd) > 0" class="bg-slate-50 font-semibold">
            <td class="border border-slate-300 px-2 py-1.5" colspan="4">Итого по долларовым товарам</td>
            <td class="tabnum border border-slate-300 px-2 py-1.5 text-right">{{ money(sale.totalUsd, 'USD') }}</td>
          </tr>
          <tr v-if="Number(sale.totalUzs) > 0" class="bg-slate-50 font-semibold">
            <td class="border border-slate-300 px-2 py-1.5" colspan="4">Итого по сумовым товарам</td>
            <td class="tabnum border border-slate-300 px-2 py-1.5 text-right">{{ money(sale.totalUzs, 'UZS') }}</td>
          </tr>
          <tr>
            <td class="border border-slate-300 px-2 py-1.5" colspan="2">Всего мест</td>
            <td class="tabnum border border-slate-300 px-2 py-1.5 text-right">{{ qty(totalQty) }}</td>
            <td class="border border-slate-300 px-2 py-1.5" colspan="2"></td>
          </tr>
        </tbody>
      </table>

      <div class="mt-4 text-xs">
        <div class="tabnum">Всего наименований {{ items.length }}</div>
        <div v-if="Number(sale.totalUsd) > 0" class="mt-1">
          Долларовая часть: <b>{{ money(sale.totalUsd, 'USD') }}</b> — {{ amountInWords(sale.totalUsd, 'USD') }}
        </div>
        <div v-if="Number(sale.totalUzs) > 0" class="mt-1">
          Сумовая часть: <b>{{ money(sale.totalUzs, 'UZS') }}</b> — {{ amountInWords(sale.totalUzs, 'UZS') }}
        </div>

        <div class="tabnum mt-1.5 border-t border-slate-300 pt-1.5">
          Оплачено:
          <b v-if="paid.USD">{{ money(paid.USD, 'USD') }}</b>
          <b v-if="paid.USD && paid.UZS"> + </b>
          <b v-if="paid.UZS">{{ money(paid.UZS, 'UZS') }}</b>
          <b v-if="!paid.USD && !paid.UZS">0</b>
          <span v-if="rest.USD || rest.UZS">
            · Задолженность:
            <b v-if="rest.USD">{{ money(rest.USD, 'USD') }}</b>
            <b v-if="rest.USD && rest.UZS"> + </b>
            <b v-if="rest.UZS">{{ money(rest.UZS, 'UZS') }}</b>
          </span>
        </div>
      </div>

      <div class="mt-10 grid gap-8 text-xs sm:grid-cols-2">
        <div>
          <div class="text-slate-600">Отпустил</div>
          <div class="mt-6 border-b border-slate-400"></div>
          <div class="mt-1 text-slate-500">{{ soldByEmail }}</div>
        </div>
        <div>
          <div class="text-slate-600">Получил</div>
          <div class="mt-6 border-b border-slate-400"></div>
          <div class="mt-1 text-slate-500">{{ customer?.contact }}</div>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="min-h-screen bg-slate-100 dark:bg-slate-100">
    <EmptyState title="Накладная не найдена" />
  </div>
</template>
