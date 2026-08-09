<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ProductCombobox from '@/components/ProductCombobox.vue'
import { money, toISODate } from '@/utils/format'
import { batches, writeoffItems, writeoffs, changeWriteoffStatus } from '@/api/resources'
import { iri } from '@/api/iri'

const REASONS = [
  'Истёк срок годности',
  'Повреждение упаковки при разгрузке',
  'Порча при хранении',
  'Пересортица/недостача',
  'Другое',
]

const route = useRoute()
const router = useRouter()

const error = ref('')

const header = reactive({ docDate: toISODate(), reason: REASONS[0] })
const draft = ref(null)
const items = ref([])
const addingItem = ref(false)
const posting = ref(false)

const selectedProduct = ref(null)
const batchOptions = ref([])
const loadingBatches = ref(false)
const line = reactive({ productId: '', batchId: '', quantity: 1 })

const loadingDraft = ref(false)

/**
 * Продолжение существующего черновика: переход с /writeoffs/:id/edit
 * («Открыть» на черновике в списке списаний). Проведённые/отменённые
 * документы сюда не редактируются — открываем их в режиме просмотра.
 */
async function loadExistingDraft(id) {
  loadingDraft.value = true
  error.value = ''
  try {
    const writeoff = await writeoffs.get(id)
    if (writeoff.status !== 'draft') {
      router.replace(`/writeoffs?doc=${id}`)
      return
    }
    draft.value = writeoff
    header.docDate = writeoff.docDate
    header.reason = writeoff.reason
    items.value = writeoff.items ?? []
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
  draft.value = await writeoffs.create({ docDate: header.docDate, reason: header.reason })
  return draft.value
}

/** Партии для выбранного товара — точечный запрос по имени товара, а не весь каталог. */
async function onProductSelect(p) {
  selectedProduct.value = p
  line.batchId = ''
  batchOptions.value = []
  loadingBatches.value = true
  try {
    const found = await batches.list({ 'product.name': p.name })
    batchOptions.value = found
      .filter((b) => b.product?.name === p.name)
      .map((b) => ({ ...b, stock: Number(b.remainingQty) }))
      .filter((b) => b.stock > 0)
  } catch {
    batchOptions.value = []
  } finally {
    loadingBatches.value = false
  }
}

const selectedBatch = computed(() => batchOptions.value.find((b) => String(b.id) === String(line.batchId)))
const lineValid = computed(
  () => selectedBatch.value && Number(line.quantity) > 0 && Number(line.quantity) <= selectedBatch.value.stock,
)

async function addItem() {
  if (!lineValid.value) return
  addingItem.value = true
  error.value = ''
  try {
    const w = await ensureDraft()
    const created = await writeoffItems.create({
      writeoff: iri('writeoffs', w.id),
      product: iri('products', line.productId),
      batch: iri('batches', selectedBatch.value.id),
      quantity: String(line.quantity),
    })
    // product/batch в ответе — голые IRI (у WriteoffItem нет normalizationContext),
    // подставляем уже известные объекты вместо похода за ними отдельно.
    items.value.push({ ...created, product: selectedProduct.value, batch: selectedBatch.value })

    const batchInList = batchOptions.value.find((b) => String(b.id) === String(selectedBatch.value.id))
    if (batchInList) batchInList.stock -= Number(line.quantity)

    line.productId = ''
    line.batchId = ''
    line.quantity = 1
    selectedProduct.value = null
    batchOptions.value = []
  } catch (e) {
    error.value = e.message
  } finally {
    addingItem.value = false
  }
}

async function removeItem(item) {
  try {
    await writeoffItems.remove(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch (e) {
    error.value = e.message
  }
}

const productName = (v) => v?.name ?? '—'
const batchNumber = (v) => v?.number ?? '—'

/** Цена берётся из уже загруженного объекта партии (batch:read из onProductSelect включает purchasePrice). */
function lossValue(item) {
  return item.batch ? Number(item.quantity) * Number(item.batch.purchasePrice ?? 0) : 0
}

const totalLoss = computed(() => items.value.reduce((sum, i) => sum + lossValue(i), 0))

async function post() {
  if (!draft.value || items.value.length === 0) return
  posting.value = true
  error.value = ''
  try {
    await changeWriteoffStatus(draft.value.id, 'posted')
    router.push('/writeoffs?doc=' + draft.value.id)
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
        На планшете/мобильном (< xl) карточка «Новое списание» должна идти первой,
        поэтому визуальный порядок задаём через order, а не переставляем разметку.
      -->
      <div class="order-2 flex min-w-0 flex-col gap-6 xl:order-1 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad shrink-0 rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <h2 class="mb-5 text-sm font-semibold text-slate-800 dark:text-slate-100">Добавить позицию</h2>

          <!-- Планшет и мобильный (< xl): товар+партия в одной строке, кол-во — в другой -->
          <div class="space-y-3 xl:hidden">
            <div class="flex gap-3">
              <div class="min-w-0 flex-1">
                <label class="label">Товар</label>
                <ProductCombobox v-model="line.productId" @select="onProductSelect" />
              </div>
              <div class="w-24 shrink-0">
                <label class="label">Кол-во</label>
                <input v-model="line.quantity" type="number" step="0.001" :max="selectedBatch?.stock" class="input" />
              </div>
            </div>

            <div>
              <label class="label">Партия</label>
              <select v-model="line.batchId" class="input" :disabled="!line.productId || loadingBatches">
                <option value="" disabled>{{ loadingBatches ? 'Загрузка…' : 'Выберите' }}</option>
                <option v-for="b in batchOptions" :key="b.id" :value="String(b.id)">
                  {{ b.number }} (остаток {{ b.stock }})
                </option>
              </select>
            </div>

            <button class="btn-primary w-full" :disabled="!lineValid || addingItem" @click="addItem">
              <AppIcon name="plus" :size="16" /> Добавить
            </button>
          </div>

          <!-- Десктоп (xl+): всё в один ряд — широкая рабочая область позволяет -->
          <div class="hidden items-end gap-3 xl:flex xl:flex-wrap">
            <div class="min-w-[180px] flex-1 basis-[220px]">
              <label class="label">Товар</label>
              <ProductCombobox v-model="line.productId" @select="onProductSelect" />
            </div>
            <div class="min-w-[160px] flex-1 basis-[200px]">
              <label class="label">Партия</label>
              <select v-model="line.batchId" class="input" :disabled="!line.productId || loadingBatches">
                <option value="" disabled>{{ loadingBatches ? 'Загрузка…' : 'Выберите' }}</option>
                <option v-for="b in batchOptions" :key="b.id" :value="String(b.id)">
                  {{ b.number }} (остаток {{ b.stock }})
                </option>
              </select>
            </div>
            <div class="w-24 shrink-0">
              <label class="label">Кол-во</label>
              <input v-model="line.quantity" type="number" step="0.001" :max="selectedBatch?.stock" class="input" />
            </div>
            <div class="shrink-0">
              <button class="btn-primary" :disabled="!lineValid || addingItem" @click="addItem">
                <AppIcon name="plus" :size="16" /> Добавить
              </button>
            </div>
          </div>
        </section>

        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl shadow-sm dark:shadow-lg dark:shadow-black/20">
          <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
          <div v-if="items.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
            <div v-for="i in items" :key="i.id" class="flex items-center justify-between gap-2 p-4">
              <div class="min-w-0">
                <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
                <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {{ batchNumber(i.batch) }} · {{ i.quantity }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="tabnum text-sm font-semibold text-slate-800 dark:text-slate-100">{{ money(lossValue(i)) }}</span>
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
                  <th class="th">Партия</th>
                  <th class="th">Кол-во</th>
                  <th class="th">Потери</th>
                  <th class="th"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in items" :key="i.id" class="table-row">
                  <td class="td">{{ productName(i.product) }}</td>
                  <td class="td text-slate-500 dark:text-slate-400">{{ batchNumber(i.batch) }}</td>
                  <td class="td tabnum">{{ i.quantity }}</td>
                  <td class="td tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(lossValue(i)) }}</td>
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

      <!-- Панель документа: дата, причина, итог и проводка — закреплена справа, тянется на всю высоту -->
      <aside class="order-1 flex flex-col xl:order-2 xl:sticky xl:top-20 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad flex flex-1 flex-col rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Новое списание</h2>
            <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>

          <div class="mt-5 space-y-5">
            <div>
              <label class="label">Дата</label>
              <input v-model="header.docDate" type="date" class="input" :disabled="!!draft" />
            </div>
            <div>
              <label class="label">Причина</label>
              <select v-model="header.reason" class="input" :disabled="!!draft">
                <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
              </select>
            </div>
          </div>

          <!-- На планшете/мобильном итог и кнопка уезжают в закреплённую снизу окна панель ниже -->
          <div class="mt-auto hidden space-y-3 border-t border-slate-200 pt-5 xl:block dark:border-slate-800">
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-500 dark:text-slate-400">Потери на сумму</span>
              <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(totalLoss) }}</span>
            </div>
            <button class="btn-primary w-full" :disabled="items.length === 0 || posting" @click="post">
              Провести списание
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
        <span class="text-slate-500 dark:text-slate-400">Потери на сумму</span>
        <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ money(totalLoss) }}</span>
      </div>
      <button class="btn-primary w-full" :disabled="items.length === 0 || posting" @click="post">
        Провести списание
      </button>
    </div>
  </div>
</template>
