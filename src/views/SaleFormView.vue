<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import ClientCombobox from '@/components/ClientCombobox.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import ProductCombobox from '@/components/ProductCombobox.vue'
import { money, qty, rateFmt, rawPrice, toISODate, unitLabel } from '@/utils/format'
import { clients, exchangeRates, paymentAllocations, payments, saleItems, sales, changePaymentStatus, changeSaleStatus } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const route = useRoute()
const router = useRouter()

const referenceRateBuy = ref('')
const referenceRateSell = ref('')
const error = ref('')

const header = reactive({ customerId: '', customerName: '', docDate: toISODate(), note: '' })
const draft = ref(null)
const items = ref([])
const addingItem = ref(false)
const posting = ref(false)

const line = reactive({ productId: '', quantity: 1, price: '', currency: 'USD', rate: '' })
const selectedProduct = ref(null)

/** Автофокус на поле товара — и возврат в него после каждой добавленной строки, без клика мышью. */
const productInputMobile = ref(null)
const productInputDesktop = ref(null)
function focusProductInput() {
  nextTick(() => {
    productInputDesktop.value?.focus()
    productInputMobile.value?.focus()
  })
}
onMounted(focusProductInput)

async function load() {
  try {
    const rates = await exchangeRates.list({ 'order[createdAt]': 'desc', itemsPerPage: 1 })
    referenceRateBuy.value = rates[0]?.rateBuy ?? ''
    referenceRateSell.value = rates[0]?.rateSell ?? ''
  } catch (e) {
    error.value = e.message
  }
}
load()

/** Комбобокс отдаёт полного клиента при выборе — сохраняем имя для отображения. */
function onClientSelect(c) {
  header.customerName = c.name
  syncHeader()
}

/** Если нужного клиента ещё нет в базе — создаём его тут же, не уходя со страницы продажи. */
const newClientModal = ref(false)
const newClientForm = reactive({ name: '', contact: '', phone: '', address: '' })
const savingClient = ref(false)
const newClientError = ref('')

function openNewClient() {
  Object.assign(newClientForm, { name: '', contact: '', phone: '', address: '' })
  newClientError.value = ''
  newClientModal.value = true
}

async function saveNewClient() {
  if (!newClientForm.name.trim()) return
  savingClient.value = true
  newClientError.value = ''
  try {
    const created = await clients.create({
      name: newClientForm.name.trim(),
      contact: newClientForm.contact || null,
      phone: newClientForm.phone || null,
      address: newClientForm.address || null,
      isActive: true,
    })
    header.customerId = String(created.id)
    header.customerName = created.name
    await syncHeader()
    newClientModal.value = false
  } catch (e) {
    newClientError.value = e.message
  } finally {
    savingClient.value = false
  }
}

const loadingDraft = ref(false)

/**
 * Продолжение существующего черновика: переход с /sales/:id/edit
 * («Продолжить» в списке продаж). Проведённые/отменённые документы сюда
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
    header.customerName = sale.customer?.name ?? ''
    header.docDate = toISODate(sale.docDate)
    header.note = sale.note ?? ''

    const allItems = await saleItems.list()
    items.value = allItems.filter((it) => String(idFromIri(it.sale)) === String(id))
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

const usedProductIds = computed(() => items.value.map((i) => String(idFromIri(i.product))))

/**
 * Курс нужен только когда валюта строки отличается от валюты товара — если товар
 * долларовый и платят долларами (или сумовый и платят сумами), конвертировать
 * нечего. Пока товар не выбран, поле показываем — направление ещё не известно.
 */
const rateNeeded = computed(() => !selectedProduct.value || line.currency !== selectedProduct.value.currency)

/**
 * Валюты совпадают — курс необязателен на бэкенде, поле не показываем и ничего
 * не отправляем. Не совпадают — подставляем ориентир для удобства, но продавец
 * может поправить: долларовый товар продают за сум — курс продажи (мы «продаём»
 * валюту товара); сумовый товар продают за доллар — курс покупки (мы «покупаем»
 * валюту оплаты).
 */
function applyRateDefault() {
  if (!selectedProduct.value) return
  if (line.currency === selectedProduct.value.currency) {
    line.rate = ''
  } else if (selectedProduct.value.currency === 'USD') {
    line.rate = referenceRateSell.value
  } else {
    line.rate = referenceRateBuy.value
  }
}

/** Комбобокс отдаёт полный товар при выборе — берём из него дефолтные валюту/цену, без похода в общий каталог. */
function onProductSelect(p) {
  selectedProduct.value = p
  line.currency = p.currency
  line.price = line.currency === 'USD' ? (p.priceUsd ?? '') : (p.priceUzs ?? '')
  applyRateDefault()
}

/** Переключение валюты подставляет цену товара в этой валюте, если она задана. */
function setCurrency(c) {
  line.currency = c
  if (!selectedProduct.value) return
  const price = c === 'USD' ? selectedProduct.value.priceUsd : selectedProduct.value.priceUzs
  if (price !== null && price !== undefined) line.price = price
  applyRateDefault()
}

const lineValid = computed(
  () => line.productId && Number(line.quantity) > 0 && (!rateNeeded.value || Number(line.rate) > 0),
)
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
    }
    if (line.price !== '' && line.price !== null) payload.price = String(line.price)
    if (line.rate !== '' && line.rate !== null) payload.rate = String(line.rate)

    const created = await saleItems.create(payload)
    // product в ответе — голый IRI (Product.name не входит в группу sale-item:read), подставляем
    // уже известный из комбобокса объект товара, чтобы не ходить за ним отдельно.
    items.value.push({ ...created, product: selectedProduct.value })

    Object.assign(line, { productId: '', quantity: 1, price: '', currency: 'USD', rate: '' })
    selectedProduct.value = null
    focusProductInput()
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
    if (idx !== -1) items.value[idx] = { ...updated, product: items.value[idx].product }

    editingItemId.value = null
  } catch (e) {
    error.value = e.message
  } finally {
    savingEdit.value = false
  }
}

const productName = (v) => v?.name ?? '—'
const batchNumber = (v) => v?.number ?? '—'

const totals = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const i of items.value) acc[i.currency] += Number(i.total)
  return acc
})

/**
 * Клиент платит сразу или уходит в долг — решаем до проводки. «Сейчас» показывает
 * поля оплаты по каждой валюте продажи; «В долг» ничего не добавляет — обычная проводка.
 */
const paymentMode = ref('now') // 'debt' | 'now' — «сейчас» по умолчанию: «в долг» финансово рискованнее и не должен быть предвыбором
const payNow = reactive({
  USD: { amount: '', method: 'cash' },
  UZS: { amount: '', method: 'cash' },
})

async function post() {
  if (!draft.value || items.value.length === 0) return
  posting.value = true
  error.value = ''
  try {
    await changeSaleStatus(draft.value.id, 'posted')
    if (paymentMode.value === 'now') {
      for (const c of ['USD', 'UZS']) {
        const total = totals.value[c]
        if (total <= 0) continue
        const amount = payNow[c].amount ? Number(payNow[c].amount) : total
        if (amount <= 0) continue
        const payment = await payments.create({
          docDate: header.docDate,
          client: iri('clients', header.customerId),
          amount: String(amount),
          currency: c,
          method: payNow[c].method,
        })
        await paymentAllocations.create({
          payment: iri('payments', payment.id),
          sale: iri('sales', draft.value.id),
          currency: c,
          amountSpent: String(amount),
          isRounding: false,
        })
        await changePaymentStatus(payment.id, 'posted')
      }
    }
    toast.success(`${draft.value.number} проведена`)
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
        На планшете/мобильном (< xl) карточка «Новая продажа» должна идти первой,
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
                  ref="productInputMobile"
                  :model-value="line.productId"
                  :exclude-ids="usedProductIds"
                  @update:model-value="(v) => (line.productId = v)"
                  @select="onProductSelect"
                />
              </div>
              <div class="w-24 shrink-0">
                <label class="label">Кол-во</label>
                <input v-model="line.quantity" type="number" step="0.001" class="input" />
              </div>
            </div>

            <div class="flex gap-2">
              <div class="min-w-0 flex-1">
                <label class="label">Цена</label>
                <input v-model="line.price" type="number" step="0.01" class="input px-2" placeholder="авто" />
              </div>
              <div v-if="rateNeeded" class="min-w-0 flex-1">
                <label class="label">Курс</label>
                <input v-model="line.rate" type="number" step="0.0001" class="input px-2" />
              </div>
              <div class="shrink-0">
                <label class="label">Валюта</label>
                <div class="inline-flex h-[38px] overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                  <button
                    v-for="(c, idx) in ['USD', 'UZS']"
                    :key="c"
                    type="button"
                    class="w-12 text-xs font-medium transition sm:w-16 sm:text-sm"
                    :class="[
                      idx === 1 ? 'border-l border-slate-300 dark:border-slate-700' : '',
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
                ref="productInputDesktop"
                :model-value="line.productId"
                :exclude-ids="usedProductIds"
                @update:model-value="(v) => (line.productId = v)"
                @select="onProductSelect"
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
              <div class="inline-flex h-[38px] overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                <button
                  v-for="(c, idx) in ['USD', 'UZS']"
                  :key="c"
                  type="button"
                  class="w-16 text-sm font-medium transition"
                  :class="[
                    idx === 1 ? 'border-l border-slate-300 dark:border-slate-700' : '',
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
            <div v-if="rateNeeded" class="w-28 shrink-0">
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

          <p v-if="!header.customerId" class="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Сначала выберите клиента — позиции добавятся в его продажу.
          </p>
        </section>

        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl shadow-sm dark:shadow-lg dark:shadow-black/20">
          <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
          <div v-if="items.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
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
                    <div v-if="i.allocations?.length" class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                      <span v-for="a in i.allocations" :key="a.id">{{ batchNumber(a.batch) }}: {{ a.quantity }} </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <button class="btn-ghost btn-sm" @click="startEdit(i)"><AppIcon name="edit" :size="14" /></button>
                    <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                  <div class="text-slate-400 dark:text-slate-500">Кол-во</div>
                  <div class="tabnum text-right text-slate-700 dark:text-slate-300">{{ qty(i.quantity) }}</div>
                  <div class="text-slate-400 dark:text-slate-500">Цена</div>
                  <div class="tabnum text-right text-slate-700 dark:text-slate-300">{{ rawPrice(i.price, i.currency) }} {{ i.currency }}</div>
                  <div class="text-slate-400 dark:text-slate-500">Курс</div>
                  <div class="tabnum text-right text-slate-700 dark:text-slate-300">{{ rateFmt(i.rate) }}</div>
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
                <th class="th">Списано с партий</th>
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
                  <td class="td tabnum">{{ qty(i.quantity) }}</td>
                  <td class="td tabnum">{{ rawPrice(i.price, i.currency) }} {{ i.currency }}</td>
                  <td class="td tabnum text-slate-500 dark:text-slate-400">{{ rateFmt(i.rate) }}</td>
                  <td class="td tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</td>
                  <td class="td text-xs text-slate-500 dark:text-slate-400">
                    <div v-for="a in i.allocations ?? []" :key="a.id">
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
          <div v-if="draft" class="flex items-center justify-between">
            <span class="text-xs text-slate-400 dark:text-slate-500">Документ</span>
            <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>

          <div class="space-y-5" :class="draft ? 'mt-5' : ''">
            <!-- На планшете (sm+) клиент и дата встают в один ряд, примечание — отдельной строкой ниже -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 xl:gap-5">
              <div>
                <div class="mb-1.5 flex items-center justify-between">
                  <label class="label mb-0">Клиент</label>
                  <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300" @click="openNewClient">
                    + Новый клиент
                  </button>
                </div>
                <ClientCombobox v-model="header.customerId" :model-label="header.customerName" @select="onClientSelect" />
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

            <!-- Оплата сразу или в долг — решаем до проводки, чтобы не уходить на страницу оплат отдельно -->
            <div>
              <label class="label">Оплата</label>
              <div class="inline-flex w-full overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                <button
                  type="button"
                  class="flex-1 py-2 text-sm font-medium transition"
                  :class="paymentMode === 'debt' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'"
                  @click="paymentMode = 'debt'"
                >
                  В долг
                </button>
                <button
                  type="button"
                  class="flex-1 border-l border-slate-300 py-2 text-sm font-medium transition dark:border-slate-700"
                  :class="paymentMode === 'now' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'"
                  @click="paymentMode = 'now'"
                >
                  Оплата сейчас
                </button>
              </div>

              <div v-if="paymentMode === 'now'" class="mt-3 space-y-3">
                <p v-if="totals.USD <= 0 && totals.UZS <= 0" class="text-xs text-slate-400 dark:text-slate-500">
                  Добавьте позиции — сумма оплаты подставится автоматически.
                </p>
                <template v-for="c in ['USD', 'UZS']" :key="c">
                  <div v-if="totals[c] > 0" class="rounded-lg border border-slate-300 p-3 dark:border-slate-800">
                    <div class="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Оплата в {{ c }}</div>
                    <div class="grid grid-cols-2 gap-2">
                      <div>
                        <label class="label">Сумма</label>
                        <input v-model="payNow[c].amount" type="number" step="0.01" class="input" :placeholder="String(totals[c])" />
                      </div>
                      <div>
                        <label class="label">Способ</label>
                        <select v-model="payNow[c].method" class="input">
                          <option value="cash">Наличные</option>
                          <option value="card">Карта</option>
                          <option value="transfer">Перевод</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- На планшете/мобильном итог и кнопка уезжают в закреплённую снизу окна панель ниже -->
          <div class="mt-auto hidden space-y-3 border-t border-slate-300 pt-5 xl:block dark:border-slate-800">
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
              {{ paymentMode === 'now' ? 'Провести и принять оплату' : 'Провести продажу' }}
            </button>
          </div>
        </section>
      </aside>
    </div>

    <!-- Закреплённая снизу окна панель с итогом и кнопкой проводки — только на планшете и мобильном -->
    <div
      class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-slate-300 bg-white/95 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:left-[248px] xl:hidden"
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
        {{ paymentMode === 'now' ? 'Провести и принять оплату' : 'Провести продажу' }}
      </button>
    </div>

    <ModalDialog v-if="newClientModal" title="Новый клиент" @close="newClientModal = false">
      <div class="space-y-3">
        <div>
          <label class="label">Название</label>
          <input v-model="newClientForm.name" class="input" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Контактное лицо</label>
            <input v-model="newClientForm.contact" class="input" />
          </div>
          <div>
            <label class="label">Телефон</label>
            <input v-model="newClientForm.phone" class="input" />
          </div>
        </div>
        <div>
          <label class="label">Адрес</label>
          <input v-model="newClientForm.address" class="input" />
        </div>
        <p v-if="newClientError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ newClientError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="newClientModal = false">Отмена</button>
        <button class="btn-primary" :disabled="savingClient || !newClientForm.name.trim()" @click="saveNewClient">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
