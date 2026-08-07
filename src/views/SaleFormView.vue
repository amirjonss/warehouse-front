<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ProductCombobox from '@/components/ProductCombobox.vue'
import { addDays, money, qty, toISODate, unitLabel } from '@/utils/format'
import {
  batches,
  clients,
  exchangeRates,
  products,
  productStock,
  saleItemAllocations,
  saleItems,
  sales,
  changeSaleStatus,
} from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const route = useRoute()
const router = useRouter()

const clientList = ref([])
const productList = ref([])
const batchList = ref([])
const referenceRate = ref('')
const error = ref('')

const header = reactive({ customerId: '', docDate: toISODate(), note: '' })
const draft = ref(null)
const items = ref([])
const allocationsByItem = ref(new Map())
const addingItem = ref(false)
const posting = ref(false)

const line = reactive({ productId: '', quantity: 1, price: '', currency: 'USD', rate: '' })

/**
 * Ходовые товары — временно считаем на клиенте по частоте в проведённых
 * отгрузках за последние 90 дней. Когда на бэкенде появится отдельный
 * эндпоинт (например GET /products/popular), эта функция заменится на
 * один запрос — компонент и остальная логика не изменятся.
 */
const popularProductIds = ref([])

async function loadPopular() {
  try {
    const [allSales, allItems] = await Promise.all([sales.list(), saleItems.list()])
    const since = toISODate(addDays(new Date(), -90))
    const postedIds = new Set(
      allSales.filter((s) => s.status === 'posted' && s.docDate >= since).map((s) => String(s.id)),
    )
    const freq = new Map()
    for (const it of allItems) {
      if (!postedIds.has(String(idFromIri(it.sale)))) continue
      const pid = String(idFromIri(it.product))
      freq.set(pid, (freq.get(pid) ?? 0) + 1)
    }
    popularProductIds.value = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([pid]) => pid)
  } catch {
    popularProductIds.value = []
  }
}

async function load() {
  try {
    const [c, p, stock, b, rates] = await Promise.all([
      clients.list(),
      products.list(),
      productStock().catch(() => []),
      batches.list().catch(() => []),
      exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 }),
    ])
    clientList.value = c
    const stockById = new Map(stock.map((s) => [String(s.id), s.remainingQty]))
    productList.value = p.map((prod) => ({ ...prod, remainingQty: stockById.get(String(prod.id)) ?? 0 }))
    batchList.value = b
    referenceRate.value = rates[0]?.rateBuy ?? ''
    line.rate = referenceRate.value
  } catch (e) {
    error.value = e.message
  }
}
load()
loadPopular()

const loadingDraft = ref(false)

/**
 * Продолжение существующего черновика: переход с /sales/:id/edit
 * («Продолжить» в списке отгрузок). Проведённые/отменённые документы сюда
 * не редактируются — открываем их в режиме просмотра.
 */
async function loadExistingDraft(id) {
  loadingDraft.value = true
  error.value = ''
  try {
    const sale = await sales.get(id)
    if (sale.status !== 'draft') {
      router.replace(`/sales?doc=${id}`)
      return
    }
    draft.value = sale
    header.customerId = String(idFromIri(sale.customer))
    header.docDate = sale.docDate
    header.note = sale.note ?? ''

    const [allItems, allocs] = await Promise.all([saleItems.list(), saleItemAllocations.list().catch(() => [])])
    items.value = allItems.filter((it) => String(idFromIri(it.sale)) === String(id))

    const map = new Map()
    for (const it of items.value) {
      map.set(
        String(it.id),
        allocs.filter((a) => String(idFromIri(a.saleItem)) === String(it.id)),
      )
    }
    allocationsByItem.value = map
  } catch (e) {
    error.value = e.message
  } finally {
    loadingDraft.value = false
  }
}
if (route.params.id) loadExistingDraft(route.params.id)

/**
 * Черновик создаётся прозрачно — при добавлении первой позиции. Пользователь
 * работает на одной странице: шапка, позиции и проводка видны сразу.
 */
async function ensureDraft() {
  if (draft.value) return draft.value
  draft.value = await sales.create({
    docDate: header.docDate,
    customer: iri('clients', header.customerId),
    note: header.note || '',
  })
  return draft.value
}

/** Правки в шапке после создания черновика уходят на сервер молча. */
async function syncHeader() {
  if (!draft.value || !header.customerId) return
  try {
    await sales.update(draft.value.id, {
      docDate: header.docDate,
      customer: iri('clients', header.customerId),
      note: header.note || '',
    })
  } catch (e) {
    error.value = e.message
  }
}

const availableProducts = computed(() => {
  const used = new Set(items.value.map((i) => String(idFromIri(i.product))))
  return productList.value.filter((p) => !used.has(String(p.id)))
})

/** Топ-6 ходовых товаров, которых ещё нет в текущей отгрузке — быстрые чипы над полем поиска. */
const quickPicks = computed(() => {
  const byId = new Map(availableProducts.value.map((p) => [String(p.id), p]))
  return popularProductIds.value.map((pid) => byId.get(pid)).filter(Boolean).slice(0, 6)
})

const selectedProduct = computed(() => productList.value.find((p) => String(p.id) === String(line.productId)) ?? null)

function onProductChange() {
  const p = productList.value.find((x) => String(x.id) === String(line.productId))
  if (!p) return
  line.currency = p.currency
  line.price = line.currency === 'USD' ? (p.priceUsd ?? '') : (p.priceUzs ?? '')
}

/** Переключение валюты подставляет цену товара в этой валюте, если она задана. */
function setCurrency(c) {
  line.currency = c
  if (!selectedProduct.value) return
  const price = c === 'USD' ? selectedProduct.value.priceUsd : selectedProduct.value.priceUzs
  if (price !== null && price !== undefined) line.price = price
}

function pickQuick(p) {
  line.productId = String(p.id)
  onProductChange()
}

const lineValid = computed(() => line.productId && Number(line.quantity) > 0 && Number(line.rate) > 0)
const canAddLine = computed(() => lineValid.value && !!header.customerId)

async function addItem() {
  if (!canAddLine.value) return
  addingItem.value = true
  error.value = ''
  try {
    const sale = await ensureDraft()
    const payload = {
      sale: iri('sales', sale.id),
      product: iri('products', line.productId),
      quantity: String(line.quantity),
      currency: line.currency,
      rate: String(line.rate),
    }
    if (line.price !== '' && line.price !== null) payload.price = String(line.price)

    const created = await saleItems.create(payload)
    items.value.push(created)

    try {
      const allocs = await saleItemAllocations.list()
      allocationsByItem.value.set(
        String(created.id),
        allocs.filter((a) => String(idFromIri(a.saleItem)) === String(created.id)),
      )
    } catch {
      /* аллокации не критичны для продолжения */
    }

    Object.assign(line, { productId: '', quantity: 1, price: '', currency: 'USD', rate: referenceRate.value })
  } catch (e) {
    error.value = e.message
  } finally {
    addingItem.value = false
  }
}

async function removeItem(item) {
  try {
    await saleItems.remove(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch (e) {
    error.value = e.message
  }
}

/** Редактирование уже добавленной строки на месте — без удаления и повторного добавления. */
const editingItemId = ref(null)
const editForm = reactive({ quantity: '', price: '', rate: '' })
const savingEdit = ref(false)

function startEdit(item) {
  editingItemId.value = item.id
  editForm.quantity = item.quantity
  editForm.price = item.price
  editForm.rate = item.rate
}

function cancelEdit() {
  editingItemId.value = null
}

async function saveEdit(item) {
  savingEdit.value = true
  error.value = ''
  try {
    const updated = await saleItems.update(item.id, {
      quantity: String(editForm.quantity),
      price: String(editForm.price),
      rate: String(editForm.rate),
    })
    const idx = items.value.findIndex((i) => i.id === item.id)
    if (idx !== -1) items.value[idx] = updated

    try {
      const allocs = await saleItemAllocations.list()
      allocationsByItem.value.set(
        String(item.id),
        allocs.filter((a) => String(idFromIri(a.saleItem)) === String(item.id)),
      )
    } catch {
      /* аллокации не критичны для продолжения */
    }

    editingItemId.value = null
  } catch (e) {
    error.value = e.message
  } finally {
    savingEdit.value = false
  }
}

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'
const batchNumber = (v) => batchList.value.find((b) => String(b.id) === String(idFromIri(v)))?.number ?? '—'

const totals = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const i of items.value) acc[i.currency] += Number(i.total)
  return acc
})

async function post() {
  if (!draft.value || items.value.length === 0) return
  posting.value = true
  error.value = ''
  try {
    await changeSaleStatus(draft.value.id, 'posted')
    router.push('/sales?doc=' + draft.value.id)
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="space-y-6 pb-32 xl:pb-0">
    <p v-if="error" class="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_336px]">
      <!--
        На планшете/мобильном (< xl) карточка «Новая отгрузка» должна идти первой,
        поэтому визуальный порядок задаём через order, а не переставляем разметку.
      -->
      <div class="order-2 flex min-w-0 flex-col gap-6 xl:order-1 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad shrink-0 rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <h2 class="mb-5 text-sm font-semibold text-slate-800 dark:text-slate-100">Добавить позицию</h2>

          <!-- Планшет и мобильный (< xl): товар+кол-во в одной строке, цена+курс+валюта — в другой -->
          <div class="space-y-3 xl:hidden">
            <div class="flex gap-3">
              <div class="min-w-0 flex-1">
                <label class="label">Товар</label>
                <ProductCombobox
                  :model-value="line.productId"
                  :options="availableProducts"
                  @update:model-value="
                    (v) => {
                      line.productId = v
                      onProductChange()
                    }
                  "
                />
              </div>
              <div class="w-24 shrink-0">
                <label class="label">Кол-во</label>
                <input v-model="line.quantity" type="number" step="0.001" class="input" />
              </div>
            </div>

            <div class="flex flex-wrap gap-3">
              <div class="min-w-[100px] flex-1">
                <label class="label">Цена</label>
                <input v-model="line.price" type="number" step="0.01" class="input" placeholder="авто" />
              </div>
              <div class="min-w-[100px] flex-1">
                <label class="label">Курс</label>
                <input v-model="line.rate" type="number" step="0.0001" class="input" />
              </div>
              <div class="shrink-0">
                <label class="label">Валюта</label>
                <div class="inline-flex h-[38px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <button
                    v-for="(c, idx) in ['USD', 'UZS']"
                    :key="c"
                    type="button"
                    class="w-16 text-sm font-medium transition"
                    :class="[
                      idx === 1 ? 'border-l border-slate-200 dark:border-slate-700' : '',
                      line.currency === c
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
                    ]"
                    @click="setCurrency(c)"
                  >
                    {{ c }}
                  </button>
                </div>
              </div>
            </div>

            <button class="btn-primary w-full" :disabled="!canAddLine || addingItem" @click="addItem">
              <AppIcon name="plus" :size="16" /> Добавить
            </button>
          </div>

          <!-- Десктоп (xl+): всё в один ряд — широкая рабочая область позволяет -->
          <div class="hidden items-end gap-3 xl:flex xl:flex-wrap">
            <div class="min-w-[180px] flex-1 basis-[220px]">
              <label class="label">Товар</label>
              <ProductCombobox
                :model-value="line.productId"
                :options="availableProducts"
                @update:model-value="
                  (v) => {
                    line.productId = v
                    onProductChange()
                  }
                "
              />
            </div>
            <div class="w-24 shrink-0">
              <label class="label">Кол-во</label>
              <input v-model="line.quantity" type="number" step="0.001" class="input" />
            </div>
            <div class="w-28 shrink-0">
              <label class="label">Цена</label>
              <input v-model="line.price" type="number" step="0.01" class="input" placeholder="авто" />
            </div>
            <div class="shrink-0">
              <label class="label">Валюта</label>
              <div class="inline-flex h-[38px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  v-for="(c, idx) in ['USD', 'UZS']"
                  :key="c"
                  type="button"
                  class="w-16 text-sm font-medium transition"
                  :class="[
                    idx === 1 ? 'border-l border-slate-200 dark:border-slate-700' : '',
                    line.currency === c
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
                  ]"
                  @click="setCurrency(c)"
                >
                  {{ c }}
                </button>
              </div>
            </div>
            <div class="w-28 shrink-0">
              <label class="label">Курс</label>
              <input v-model="line.rate" type="number" step="0.0001" class="input" />
            </div>
            <div class="shrink-0">
              <button class="btn-primary" :disabled="!canAddLine || addingItem" @click="addItem">
                <AppIcon name="plus" :size="16" /> Добавить
              </button>
            </div>
          </div>

          <p v-if="selectedProduct" class="mt-2 text-xs">
            <span :class="Number(selectedProduct.remainingQty) > 0 ? 'text-slate-400 dark:text-slate-500' : 'text-red-500 dark:text-red-400'">
              В наличии:
              {{ Number(selectedProduct.remainingQty) > 0 ? `${qty(selectedProduct.remainingQty)} ${unitLabel(selectedProduct.unit)}` : 'нет на складе' }}
            </span>
            <span v-if="Number(line.quantity) > Number(selectedProduct.remainingQty)" class="ml-1 text-amber-600 dark:text-amber-400">
              — указано больше, чем есть в наличии
            </span>
          </p>

          <div v-if="quickPicks.length" class="mt-3 flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-slate-400 dark:text-slate-500">Часто добавляют:</span>
            <button
              v-for="p in quickPicks"
              :key="p.id"
              type="button"
              class="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-indigo-500/50 dark:hover:text-indigo-300"
              @click="pickQuick(p)"
            >
              {{ p.name }}
              <span class="tabnum text-slate-400 dark:text-slate-500">· {{ qty(p.remainingQty) }}</span>
            </button>
          </div>

          <p v-if="!header.customerId" class="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Сначала выберите клиента — позиции добавятся в его отгрузку.
          </p>
        </section>

        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl shadow-sm dark:shadow-lg dark:shadow-black/20">
          <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
          <div v-if="items.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
            <div v-for="i in items" :key="i.id" class="p-4">
              <template v-if="editingItemId === i.id">
                <div class="mb-3 font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
                <div class="grid grid-cols-3 gap-2">
                  <div>
                    <label class="label">Кол-во</label>
                    <input v-model="editForm.quantity" type="number" step="0.001" class="input h-8 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label class="label">Цена</label>
                    <input v-model="editForm.price" type="number" step="0.01" class="input h-8 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label class="label">Курс</label>
                    <input v-model="editForm.rate" type="number" step="0.0001" class="input h-8 px-2 py-1 text-sm" />
                  </div>
                </div>
                <div class="mt-3 flex gap-2">
                  <button class="btn-primary btn-sm flex-1" :disabled="savingEdit" @click="saveEdit(i)">
                    <AppIcon name="check" :size="14" /> Сохранить
                  </button>
                  <button class="btn-ghost btn-sm flex-1" :disabled="savingEdit" @click="cancelEdit">
                    <AppIcon name="close" :size="14" /> Отмена
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
                    <div v-if="allocationsByItem.get(String(i.id))?.length" class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                      <span v-for="a in allocationsByItem.get(String(i.id))" :key="a.id">{{ batchNumber(a.batch) }}: {{ a.quantity }} </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <button class="btn-ghost btn-sm" @click="startEdit(i)"><AppIcon name="edit" :size="14" /></button>
                    <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                  <div class="text-slate-400 dark:text-slate-500">Кол-во</div>
                  <div class="tabnum text-right text-slate-700 dark:text-slate-300">{{ i.quantity }}</div>
                  <div class="text-slate-400 dark:text-slate-500">Цена</div>
                  <div class="tabnum text-right text-slate-700 dark:text-slate-300">{{ i.price }} {{ i.currency }}</div>
                  <div class="text-slate-400 dark:text-slate-500">Курс</div>
                  <div class="tabnum text-right text-slate-700 dark:text-slate-300">{{ i.rate }}</div>
                  <div class="text-slate-400 dark:text-slate-500">Сумма</div>
                  <div class="tabnum text-right font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</div>
                </div>
              </template>
            </div>
          </div>

          <!-- sm и выше: обычная таблица (со скроллом вбок, если не влезает) -->
          <div v-if="items.length" class="hidden overflow-x-auto sm:block">
            <table class="w-full min-w-[720px]">
            <thead>
              <tr>
                <th class="th">Товар</th>
                <th class="th">Кол-во</th>
                <th class="th">Цена</th>
                <th class="th">Курс</th>
                <th class="th">Сумма</th>
                <th class="th">Списано с батчей</th>
                <th class="th"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="i in items" :key="i.id">
                <!-- Режим редактирования: количество, цена и курс правятся на месте -->
                <tr v-if="editingItemId === i.id" class="table-row bg-indigo-50/50 dark:bg-indigo-500/5">
                  <td class="td font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</td>
                  <td class="td">
                    <input v-model="editForm.quantity" type="number" step="0.001" class="input h-8 px-2 py-1 text-sm" />
                  </td>
                  <td class="td">
                    <input v-model="editForm.price" type="number" step="0.01" class="input h-8 px-2 py-1 text-sm" />
                  </td>
                  <td class="td">
                    <input v-model="editForm.rate" type="number" step="0.0001" class="input h-8 px-2 py-1 text-sm" />
                  </td>
                  <td class="td text-xs text-slate-400 dark:text-slate-500" colspan="2">Сумма пересчитается после сохранения</td>
                  <td class="td text-right">
                    <div class="flex justify-end gap-1">
                      <button class="btn-primary btn-sm" :disabled="savingEdit" @click="saveEdit(i)">
                        <AppIcon name="check" :size="14" />
                      </button>
                      <button class="btn-ghost btn-sm" :disabled="savingEdit" @click="cancelEdit">
                        <AppIcon name="close" :size="14" />
                      </button>
                    </div>
                  </td>
                </tr>
                <!-- Режим просмотра -->
                <tr v-else class="table-row">
                  <td class="td">{{ productName(i.product) }}</td>
                  <td class="td tabnum">{{ i.quantity }}</td>
                  <td class="td tabnum">{{ i.price }} {{ i.currency }}</td>
                  <td class="td tabnum text-slate-500 dark:text-slate-400">{{ i.rate }}</td>
                  <td class="td tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</td>
                  <td class="td text-xs text-slate-500 dark:text-slate-400">
                    <div v-for="a in allocationsByItem.get(String(i.id)) ?? []" :key="a.id">
                      {{ batchNumber(a.batch) }}: {{ a.quantity }}
                    </div>
                  </td>
                  <td class="td text-right">
                    <div class="flex justify-end gap-1">
                      <button class="btn-ghost btn-sm" @click="startEdit(i)"><AppIcon name="edit" :size="14" /></button>
                      <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          </div>
          <div v-else class="flex flex-1 items-center justify-center">
            <EmptyState icon="boxes" title="Позиций пока нет" text="Добавьте хотя бы одну строку" />
          </div>
        </section>
      </div>

      <!-- Панель документа: клиент, дата, итог и проводка — закреплена справа, тянется на всю высоту -->
      <aside class="order-1 flex flex-col xl:order-2 xl:sticky xl:top-20 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad flex flex-1 flex-col rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Новая отгрузка</h2>
            <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>

          <div class="mt-5 space-y-5">
            <!-- На планшете (sm+) клиент и дата встают в один ряд, примечание — отдельной строкой ниже -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 xl:gap-5">
              <div>
                <label class="label">Клиент</label>
                <select v-model="header.customerId" class="input" @change="syncHeader">
                  <option value="" disabled>Выберите клиента</option>
                  <option v-for="c in clientList" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
                </select>
              </div>
              <div>
                <label class="label">Дата</label>
                <input v-model="header.docDate" type="date" class="input" @change="syncHeader" />
              </div>
            </div>
            <div>
              <label class="label">Примечание</label>
              <input v-model="header.note" class="input" placeholder="Необязательно" @change="syncHeader" />
            </div>
          </div>

          <!-- На планшете/мобильном итог и кнопка уезжают в закреплённую снизу окна панель ниже -->
          <div class="mt-auto hidden space-y-3 border-t border-slate-200 pt-5 xl:block dark:border-slate-800">
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-500 dark:text-slate-400">Итого</span>
              <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">
                <template v-if="totals.USD > 0">{{ money(totals.USD, 'USD') }}</template>
                <template v-if="totals.USD > 0 && totals.UZS > 0"> + </template>
                <template v-if="totals.UZS > 0">{{ money(totals.UZS, 'UZS') }}</template>
                <template v-if="totals.USD <= 0 && totals.UZS <= 0">0</template>
              </span>
            </div>
            <button class="btn-primary w-full" :disabled="items.length === 0 || posting" @click="post">
              Провести отгрузку
            </button>
          </div>
        </section>
      </aside>
    </div>

    <!-- Закреплённая снизу окна панель с итогом и кнопкой проводки — только на планшете и мобильном -->
    <div
      class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:left-[248px] xl:hidden"
    >
      <div class="flex items-center justify-between text-sm">
        <span class="text-slate-500 dark:text-slate-400">Итого</span>
        <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">
          <template v-if="totals.USD > 0">{{ money(totals.USD, 'USD') }}</template>
          <template v-if="totals.USD > 0 && totals.UZS > 0"> + </template>
          <template v-if="totals.UZS > 0">{{ money(totals.UZS, 'UZS') }}</template>
          <template v-if="totals.USD <= 0 && totals.UZS <= 0">0</template>
        </span>
      </div>
      <button class="btn-primary w-full" :disabled="items.length === 0 || posting" @click="post">
        Провести отгрузку
      </button>
    </div>
  </div>
</template>
