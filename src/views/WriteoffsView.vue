<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date, money, toISODate } from '@/utils/format'
import { batches, products, writeoffItems, writeoffs, changeWriteoffStatus } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const REASONS = [
  'Истёк срок годности',
  'Повреждение упаковки при разгрузке',
  'Порча при хранении',
  'Пересортица/недостача',
  'Другое',
]

const list = ref([])
const productList = ref([])
const batchList = ref([])
const itemsByWriteoff = ref(new Map())
const loading = ref(true)
const error = ref('')
const opened = ref(null)

const modal = ref(false)
const header = reactive({ docDate: toISODate(), reason: REASONS[0] })
const draft = ref(null)
const items = ref([])
const line = reactive({ productId: '', batchId: '', quantity: 1 })
const posting = ref(false)

const STATUS = { draft: 'черновик', posted: 'проведено', cancelled: 'отменено' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [w, p, b, wi] = await Promise.all([
      writeoffs.list(),
      products.list(),
      batches.list(),
      writeoffItems.list(),
    ])
    list.value = w.sort((a, b2) => b2.docDate.localeCompare(a.docDate))
    productList.value = p
    batchList.value = b
    const map = new Map()
    for (const it of wi) {
      const wid = idFromIri(it.writeoff)
      if (!map.has(wid)) map.set(wid, [])
      map.get(wid).push(it)
    }
    itemsByWriteoff.value = map
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'
const batchNumber = (v) => batchList.value.find((b) => String(b.id) === String(idFromIri(v)))?.number ?? '—'

/*
 * ВРЕМЕННО: batch.product сейчас приходит с бэкенда как embedded-объект с
 * фиктивным @id ("/api/products/summary" одинаковый у всех партий), поэтому
 * сопоставить по ID нельзя — сравниваем по названию товара. Как только
 * бэкенд начнёт отдавать настоящий IRI, вернуть сравнение по id.
 */
const batchesForProduct = computed(() => {
  const selectedName = productList.value.find((p) => String(p.id) === String(line.productId))?.name
  if (!selectedName) return []
  return batchList.value
    .filter((b) => b.product?.name === selectedName)
    .map((b) => ({ ...b, stock: Number(b.remainingQty) }))
    .filter((b) => b.stock > 0)
})
const selectedBatch = computed(() => batchesForProduct.value.find((b) => String(b.id) === String(line.batchId)))
const lineValid = computed(
  () => selectedBatch.value && Number(line.quantity) > 0 && Number(line.quantity) <= selectedBatch.value.stock,
)

function openNew() {
  Object.assign(header, { docDate: toISODate(), reason: REASONS[0] })
  draft.value = null
  items.value = []
  Object.assign(line, { productId: '', batchId: '', quantity: 1 })
  error.value = ''
  modal.value = true
}

async function createDraft() {
  error.value = ''
  try {
    draft.value = await writeoffs.create({ docDate: header.docDate, reason: header.reason })
  } catch (e) {
    error.value = e.message
  }
}

async function addItem() {
  if (!lineValid.value || !draft.value) return
  error.value = ''
  try {
    const created = await writeoffItems.create({
      writeoff: iri('writeoffs', draft.value.id),
      product: iri('products', line.productId),
      batch: iri('batches', selectedBatch.value.id),
      quantity: String(line.quantity),
    })
    items.value.push(created)
    const batch = batchList.value.find((b) => String(b.id) === String(selectedBatch.value.id))
    if (batch) batch.remainingQty = String(Number(batch.remainingQty) - Number(line.quantity))
    Object.assign(line, { productId: '', batchId: '', quantity: 1 })
  } catch (e) {
    error.value = e.message
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

async function post() {
  if (!draft.value || items.value.length === 0) return
  posting.value = true
  error.value = ''
  try {
    await changeWriteoffStatus(draft.value.id, 'posted')
    modal.value = false
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}

function lossValue(item) {
  const batch = batchList.value.find((b) => String(b.id) === String(idFromIri(item.batch)))
  return batch ? Number(item.quantity) * Number(batch.purchasePrice) : 0
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="text-sm text-slate-500 dark:text-slate-400">Всего списаний: {{ list.length }}</div>
      <button class="btn-primary btn-sm" @click="openNew">
        <AppIcon name="plus" :size="16" /> Новое списание
      </button>
    </div>

    <p v-if="error && !modal" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <div v-if="list.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div class="cursor-pointer p-4" v-for="w in list" :key="w.id" @click="opened = w">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ w.number }}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{{ date(w.docDate) }} · {{ w.reason }}</div>
            </div>
            <span class="badge shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{{ STATUS[w.status] }}</span>
          </div>
          <div class="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Позиций: {{ (itemsByWriteoff.get(String(w.id)) ?? []).length }}
          </div>
        </div>
      </div>

      <table v-if="list.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Номер</th>
            <th class="th">Дата</th>
            <th class="th">Причина</th>
            <th class="th">Позиций</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in list" :key="w.id" class="table-row">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ w.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(w.docDate) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ w.reason }}</td>
            <td class="td tabnum">{{ (itemsByWriteoff.get(String(w.id)) ?? []).length }}</td>
            <td class="td"><span class="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{{ STATUS[w.status] }}</span></td>
            <td class="td text-right">
              <button class="btn-ghost btn-sm" @click="opened = w">Открыть</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="trash" title="Списаний пока нет" />
    </div>

    <ModalDialog v-if="opened" :title="opened.number" :subtitle="date(opened.docDate) + ' · ' + opened.reason" @close="opened = null">
      <div class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div v-for="i in itemsByWriteoff.get(String(opened.id)) ?? []" :key="i.id" class="py-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
            <div class="tabnum shrink-0 text-slate-700 dark:text-slate-300">{{ i.quantity }}</div>
          </div>
          <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ batchNumber(i.batch) }}</div>
        </div>
      </div>

      <table class="hidden w-full text-sm sm:table">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="py-1.5 pr-3">Товар</th>
            <th class="px-3 py-1.5">Партия</th>
            <th class="py-1.5 pl-3 text-right">Кол-во</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itemsByWriteoff.get(String(opened.id)) ?? []" :key="i.id" class="border-t border-slate-100 dark:border-slate-800">
            <td class="py-1.5 pr-3">{{ productName(i.product) }}</td>
            <td class="px-3 py-1.5">{{ batchNumber(i.batch) }}</td>
            <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap">{{ i.quantity }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="modal" title="Новое списание" width="max-w-2xl" @close="modal = false">
      <p v-if="error" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

      <div v-if="!draft" class="space-y-3">
        <div>
          <label class="label">Дата</label>
          <input v-model="header.docDate" type="date" class="input" />
        </div>
        <div>
          <label class="label">Причина</label>
          <select v-model="header.reason" class="input">
            <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <button class="btn-primary w-full" @click="createDraft">Создать черновик и добавить позиции</button>
      </div>

      <div v-else class="space-y-4">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="label">Товар</label>
            <select v-model="line.productId" class="input" @change="line.batchId = ''">
              <option value="" disabled>Выберите</option>
              <option v-for="p in productList" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">Партия</label>
            <select v-model="line.batchId" class="input" :disabled="!line.productId">
              <option value="" disabled>Выберите</option>
              <option v-for="b in batchesForProduct" :key="b.id" :value="String(b.id)">
                {{ b.number }} (остаток {{ b.stock }})
              </option>
            </select>
          </div>
          <div>
            <label class="label">Количество</label>
            <input v-model="line.quantity" type="number" step="0.001" :max="selectedBatch?.stock" class="input" />
          </div>
        </div>
        <button class="btn-ghost w-full" :disabled="!lineValid" @click="addItem">
          <AppIcon name="plus" :size="16" /> Добавить в списание
        </button>

        <div v-if="items.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
          <div v-for="i in items" :key="i.id" class="flex items-center justify-between gap-2 py-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
              <div class="tabnum mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {{ batchNumber(i.batch) }} · {{ i.quantity }} · {{ money(lossValue(i)) }}
              </div>
            </div>
            <button class="btn-ghost btn-sm shrink-0" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
          </div>
        </div>

        <table v-if="items.length" class="hidden w-full text-sm sm:table">
          <thead>
            <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
              <th class="py-1.5 pr-3">Товар</th>
              <th class="px-3 py-1.5">Партия</th>
              <th class="px-3 py-1.5 text-right">Кол-во</th>
              <th class="px-3 py-1.5 text-right">Потери</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in items" :key="i.id" class="border-t border-slate-100 dark:border-slate-800">
              <td class="py-1.5 pr-3">{{ productName(i.product) }}</td>
              <td class="px-3 py-1.5">{{ batchNumber(i.batch) }}</td>
              <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ i.quantity }}</td>
              <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ money(lossValue(i)) }}</td>
              <td class="py-1.5 pl-3 text-right"><button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <button class="btn-ghost" @click="modal = false">{{ draft ? 'Закрыть' : 'Отмена' }}</button>
        <button v-if="draft" class="btn-primary" :disabled="items.length === 0 || posting" @click="post">
          Провести списание
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
