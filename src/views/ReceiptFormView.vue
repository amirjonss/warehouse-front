<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import ProductCombobox from '@/components/ProductCombobox.vue'
import { money, priceOrDash, qty, rawPrice, toISODate } from '@/utils/format'
import { api } from '@/api/client'
import { exchangeRates, products, receiptItems, receipts, suppliers, changeReceiptStatus } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const route = useRoute()
const router = useRouter()

const supplierList = ref([])
const referenceRate = ref('')
const error = ref('')

const header = reactive({ supplierId: '', docDate: toISODate(), note: '' })
const draft = ref(null)
const items = ref([])
const addingItem = ref(false)
const posting = ref(false)

const line = reactive({ productId: '', quantity: 10, price: '', currency: 'USD', rate: '', newPriceUsd: '', newPriceUzs: '' })
const selectedProduct = ref(null)
const lastPurchase = ref(null)

/** Приход — удобный момент обновить отпускную цену товара вместе с позицией; подсказка «прошлая цена» берётся из последней партии. */
async function onProductSelect(p) {
  selectedProduct.value = p
  line.newPriceUsd = p.priceUsd ?? ''
  line.newPriceUzs = p.priceUzs ?? ''
  lastPurchase.value = null
  try {
    const { items } = await api.getPage('/batches', { product: p.id, 'order[receivedAt]': 'desc', 'order[id]': 'desc', page: 1 })
    lastPurchase.value = items[0] ?? null
  } catch {
    lastPurchase.value = null
  }
}

function priceChanged(newVal, oldVal) {
  const n = newVal === '' || newVal === null || newVal === undefined ? null : Number(newVal)
  const o = oldVal === null || oldVal === undefined ? null : Number(oldVal)
  return n !== o
}

watch(
  () => line.productId,
  (v) => {
    if (!v) {
      selectedProduct.value = null
      lastPurchase.value = null
    }
  },
)

/** Поставщика может не быть в базе — создаём тут же, не уходя со страницы прихода. */
const newSupplierModal = ref(false)
const newSupplierForm = reactive({ name: '', contact: '', phone: '', address: '' })
const savingSupplier = ref(false)
const newSupplierError = ref('')

function openNewSupplier() {
  Object.assign(newSupplierForm, { name: '', contact: '', phone: '', address: '' })
  newSupplierError.value = ''
  newSupplierModal.value = true
}

async function saveNewSupplier() {
  if (!newSupplierForm.name.trim()) return
  savingSupplier.value = true
  newSupplierError.value = ''
  try {
    const created = await suppliers.create({
      name: newSupplierForm.name.trim(),
      contact: newSupplierForm.contact || null,
      phone: newSupplierForm.phone || null,
      address: newSupplierForm.address || null,
      isActive: true,
    })
    supplierList.value.push(created)
    header.supplierId = String(created.id)
    await syncHeader()
    newSupplierModal.value = false
  } catch (e) {
    newSupplierError.value = e.message
  } finally {
    savingSupplier.value = false
  }
}

async function load() {
  try {
    const [s, rates] = await Promise.all([
      suppliers.list(),
      exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 }),
    ])
    supplierList.value = s
    referenceRate.value = rates[0]?.rateBuy ?? ''
    line.rate = referenceRate.value
  } catch (e) {
    error.value = e.message
  }
}
load()

const loadingDraft = ref(false)

/**
 * Продолжение существующего черновика: переход с /receipts/:id/edit
 * («Открыть» на черновике в списке приходов). Проведённые/отменённые
 * документы сюда не редактируются — открываем их в режиме просмотра.
 */
async function loadExistingDraft(id) {
  loadingDraft.value = true
  error.value = ''
  try {
    const receipt = await receipts.get(id)
    if (receipt.status !== 'draft') {
      router.replace(`/receipts?doc=${id}`)
      return
    }
    draft.value = receipt
    header.supplierId = String(idFromIri(receipt.supplier))
    header.docDate = toISODate(receipt.docDate)
    header.note = receipt.note ?? ''
    items.value = receipt.items ?? []
  } catch (e) {
    error.value = e.message
  } finally {
    loadingDraft.value = false
  }
}
if (route.params.id) loadExistingDraft(route.params.id)

/**
 * Черновик создаётся прозрачно — при добавлении первой позиции. Пользователь
 * работает на одной странице: шапка и позиции видны сразу.
 */
async function ensureDraft() {
  if (draft.value) return draft.value
  draft.value = await receipts.create({
    docDate: header.docDate,
    supplier: iri('suppliers', header.supplierId),
    note: header.note || '',
  })
  return draft.value
}

/** Правки в шапке после создания черновика уходят на сервер молча. */
async function syncHeader() {
  if (!draft.value || !header.supplierId) return
  try {
    await receipts.update(draft.value.id, {
      docDate: header.docDate,
      supplier: iri('suppliers', header.supplierId),
      note: header.note || '',
    })
  } catch (e) {
    error.value = e.message
  }
}

const usedProductIds = computed(() => items.value.map((i) => String(idFromIri(i.product))))

const lineValid = computed(() => line.productId && Number(line.quantity) > 0 && Number(line.price) > 0 && Number(line.rate) > 0)
const canAddLine = computed(() => lineValid.value && !!header.supplierId)

async function addItem() {
  if (!canAddLine.value) return
  addingItem.value = true
  error.value = ''
  try {
    const r = await ensureDraft()
    const created = await receiptItems.create({
      receipt: iri('receipts', r.id),
      product: iri('products', line.productId),
      quantity: String(line.quantity),
      price: String(line.price),
      currency: line.currency,
      rate: line.currency === 'UZS' ? '1' : String(line.rate),
    })
    items.value.push(created)
    if (selectedProduct.value && (priceChanged(line.newPriceUsd, selectedProduct.value.priceUsd) || priceChanged(line.newPriceUzs, selectedProduct.value.priceUzs))) {
      await products.update(selectedProduct.value.id, {
        priceUsd: line.newPriceUsd === '' ? null : String(line.newPriceUsd),
        priceUzs: line.newPriceUzs === '' ? null : String(line.newPriceUzs),
      })
    }
    line.productId = ''
    line.quantity = 10
    line.price = 0
    line.newPriceUsd = ''
    line.newPriceUzs = ''
    selectedProduct.value = null
  } catch (e) {
    error.value = e.message
  } finally {
    addingItem.value = false
  }
}

async function removeItem(item) {
  try {
    await receiptItems.remove(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch (e) {
    error.value = e.message
  }
}

const productName = (v) => v?.name ?? '—'

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
    await changeReceiptStatus(draft.value.id, 'posted')
    toast.success(`${draft.value.number} проведён`)
    router.push('/receipts?doc=' + draft.value.id)
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
        На планшете/мобильном (< xl) карточка «Новый приход» должна идти первой,
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
                <ProductCombobox v-model="line.productId" :exclude-ids="usedProductIds" @select="onProductSelect" />
              </div>
              <div class="w-24 shrink-0">
                <label class="label">Кол-во</label>
                <input v-model="line.quantity" type="number" step="0.001" class="input" />
              </div>
            </div>

            <div class="flex gap-2">
              <div class="min-w-0 flex-1">
                <label class="label">Цена</label>
                <input v-model="line.price" type="number" step="0.01" class="input px-2" />
              </div>
              <div class="min-w-0 flex-1">
                <label class="label">Курс</label>
                <input v-model="line.rate" type="number" step="0.0001" class="input px-2" :disabled="line.currency === 'UZS'" />
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
                    @click="line.currency = c; line.rate = c === 'UZS' ? '1' : referenceRate"
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
              <ProductCombobox v-model="line.productId" :exclude-ids="usedProductIds" @select="onProductSelect" />
            </div>
            <div class="w-24 shrink-0">
              <label class="label">Кол-во</label>
              <input v-model="line.quantity" type="number" step="0.001" class="input" />
            </div>
            <div class="w-28 shrink-0">
              <label class="label">Цена</label>
              <input v-model="line.price" type="number" step="0.01" class="input" />
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
                  @click="line.currency = c; line.rate = c === 'UZS' ? '1' : referenceRate"
                >
                  {{ c }}
                </button>
              </div>
            </div>
            <div class="w-28 shrink-0">
              <label class="label">Курс</label>
              <input v-model="line.rate" type="number" step="0.0001" class="input" :disabled="line.currency === 'UZS'" />
            </div>
            <div class="shrink-0">
              <button class="btn-primary" :disabled="!canAddLine || addingItem" @click="addItem">
                <AppIcon name="plus" :size="16" /> Добавить
              </button>
            </div>
          </div>

          <p v-if="lastPurchase" class="tabnum mt-3 text-xs text-slate-400 dark:text-slate-500">Прошлая цена: {{ rawPrice(lastPurchase.purchasePrice, lastPurchase.currency) }} {{ lastPurchase.currency }}</p>

          <div v-if="selectedProduct" class="mt-3 space-y-2.5 rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div class="text-xs text-slate-500 dark:text-slate-400">
              Текущая цена продажи:
              <span class="tabnum font-medium text-slate-700 dark:text-slate-300">{{ priceOrDash(selectedProduct.priceUsd, 'USD') }} $ / {{ priceOrDash(selectedProduct.priceUzs, 'UZS') }} сум</span>
            </div>
            <div class="flex flex-wrap gap-3">
              <div class="min-w-[120px] flex-1">
                <label class="label">Новая цена, $</label>
                <input v-model="line.newPriceUsd" type="number" step="0.01" class="input" placeholder="без изменений" />
              </div>
              <div class="min-w-[120px] flex-1">
                <label class="label">Новая цена, сум</label>
                <input v-model="line.newPriceUzs" type="number" step="1000" class="input" placeholder="без изменений" />
              </div>
            </div>
          </div>

          <p v-if="!header.supplierId" class="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Сначала выберите поставщика — позиции добавятся в его приход.
          </p>
        </section>

        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl shadow-sm dark:shadow-lg dark:shadow-black/20">
          <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
          <div v-if="items.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
            <div v-for="i in items" :key="i.id" class="flex items-center justify-between gap-2 p-4">
              <div class="min-w-0">
                <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
                <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {{ qty(i.quantity) }} × {{ rawPrice(i.price, i.currency) }} {{ i.currency }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="tabnum text-sm font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</span>
                <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
              </div>
            </div>
          </div>

          <!-- sm и выше: обычная таблица (со скроллом вбок, если не влезает) -->
          <div v-if="items.length" class="hidden overflow-x-auto sm:block">
            <table class="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th class="th">Товар</th>
                  <th class="th">Кол-во</th>
                  <th class="th">Цена</th>
                  <th class="th">Курс</th>
                  <th class="th">Сумма</th>
                  <th class="th"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in items" :key="i.id" class="table-row">
                  <td class="td">{{ productName(i.product) }}</td>
                  <td class="td tabnum">{{ qty(i.quantity) }}</td>
                  <td class="td tabnum">{{ rawPrice(i.price, i.currency) }} {{ i.currency }}</td>
                  <td class="td tabnum text-slate-500 dark:text-slate-400">{{ i.rate }}</td>
                  <td class="td tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</td>
                  <td class="td text-right">
                    <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="flex flex-1 items-center justify-center">
            <EmptyState icon="boxes" title="Позиций пока нет" text="Добавьте хотя бы одну строку" />
          </div>
        </section>
      </div>

      <!-- Панель документа: поставщик, дата, итог и проводка — закреплена справа, тянется на всю высоту -->
      <aside class="order-1 flex flex-col xl:order-2 xl:sticky xl:top-20 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad flex flex-1 flex-col rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Новый приход</h2>
            <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>

          <div class="mt-5 space-y-5">
            <!-- На планшете (sm+) поставщик и дата встают в один ряд, примечание — отдельной строкой ниже -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 xl:gap-5">
              <div>
                <div class="mb-1.5 flex items-center justify-between">
                  <label class="label mb-0">Поставщик</label>
                  <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300" @click="openNewSupplier">
                    + Новый поставщик
                  </button>
                </div>
                <select v-model="header.supplierId" class="input" @change="syncHeader">
                  <option value="" disabled>Выберите поставщика</option>
                  <option v-for="s in supplierList" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
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
              Провести приход
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
        Провести приход
      </button>
    </div>

    <ModalDialog v-if="newSupplierModal" title="Новый поставщик" @close="newSupplierModal = false">
      <div class="space-y-3">
        <div>
          <label class="label">Название</label>
          <input v-model="newSupplierForm.name" class="input" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Контактное лицо</label>
            <input v-model="newSupplierForm.contact" class="input" />
          </div>
          <div>
            <label class="label">Телефон</label>
            <input v-model="newSupplierForm.phone" class="input" />
          </div>
        </div>
        <div>
          <label class="label">Адрес</label>
          <input v-model="newSupplierForm.address" class="input" />
        </div>
        <p v-if="newSupplierError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ newSupplierError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="newSupplierModal = false">Отмена</button>
        <button class="btn-primary" :disabled="savingSupplier || !newSupplierForm.name.trim()" @click="saveNewSupplier">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
