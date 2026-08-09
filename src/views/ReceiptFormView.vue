<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ProductCombobox from '@/components/ProductCombobox.vue'
import { money, toISODate } from '@/utils/format'
import { exchangeRates, products, receiptItems, receipts, suppliers, changeReceiptStatus } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const route = useRoute()
const router = useRouter()

const supplierList = ref([])
const productList = ref([])
const referenceRate = ref('')
const error = ref('')

const header = reactive({ supplierId: '', docDate: toISODate(), note: '' })
const draft = ref(null)
const items = ref([])
const addingItem = ref(false)
const posting = ref(false)

const line = reactive({ productId: '', quantity: 10, price: '', currency: 'USD', rate: '' })

async function load() {
  try {
    const [s, p, rates] = await Promise.all([
      suppliers.list(),
      products.list(),
      exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 }),
    ])
    supplierList.value = s
    productList.value = p
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
    header.docDate = receipt.docDate
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

const availableProducts = computed(() => {
  const used = new Set(items.value.map((i) => String(idFromIri(i.product))))
  return productList.value.filter((p) => !used.has(String(p.id)))
})

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
    line.productId = ''
    line.quantity = 10
    line.price = 0
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

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'

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
                <ProductCombobox v-model="line.productId" :options="availableProducts" />
              </div>
              <div class="w-24 shrink-0">
                <label class="label">Кол-во</label>
                <input v-model="line.quantity" type="number" step="0.001" class="input" />
              </div>
            </div>

            <div class="flex flex-wrap gap-3">
              <div class="min-w-[100px] flex-1">
                <label class="label">Цена</label>
                <input v-model="line.price" type="number" step="0.01" class="input" />
              </div>
              <div class="min-w-[100px] flex-1">
                <label class="label">Курс</label>
                <input v-model="line.rate" type="number" step="0.0001" class="input" :disabled="line.currency === 'UZS'" />
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
              <ProductCombobox v-model="line.productId" :options="availableProducts" />
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

          <p v-if="!header.supplierId" class="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Сначала выберите поставщика — позиции добавятся в его приход.
          </p>
        </section>

        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl shadow-sm dark:shadow-lg dark:shadow-black/20">
          <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
          <div v-if="items.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
            <div v-for="i in items" :key="i.id" class="flex items-center justify-between gap-2 p-4">
              <div class="min-w-0">
                <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
                <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {{ i.quantity }} × {{ i.price }} {{ i.currency }}
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
                  <td class="td tabnum">{{ i.quantity }}</td>
                  <td class="td tabnum">{{ i.price }} {{ i.currency }}</td>
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
                <label class="label">Поставщик</label>
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
              Провести приход
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
        Провести приход
      </button>
    </div>
  </div>
</template>
