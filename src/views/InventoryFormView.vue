<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ProductCombobox from '@/components/ProductCombobox.vue'
import { qty, toISODate } from '@/utils/format'
import {
  categories,
  changeInventoryStatus,
  fillInventory,
  inventories,
  inventoryItems,
} from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const error = ref('')

const header = reactive({ docDate: toISODate(), note: '', categoryId: '' })
const draft = ref(null)
const items = ref([])
const addingItem = ref(false)
const filling = ref(false)
const posting = ref(false)

const categoryOptions = ref([])
const selectedProduct = ref(null)
const line = reactive({ productId: '' })

onMounted(async () => {
  try {
    categoryOptions.value = await categories.list()
  } catch {
    categoryOptions.value = []
  }
})

/**
 * Продолжение существующего черновика — переход с /inventories/:id/edit.
 * Проведённые и отменённые документы сюда не редактируются.
 */
async function loadExistingDraft(id) {
  error.value = ''
  try {
    const inventory = await inventories.get(id)
    if (inventory.status !== 'draft') {
      router.replace(`/inventories?doc=${id}`)
      return
    }
    draft.value = inventory
    header.docDate = toISODate(inventory.docDate)
    header.note = inventory.note ?? ''
    header.categoryId = inventory.category ? String(inventory.category.id) : ''
    items.value = inventory.items ?? []
  } catch (e) {
    error.value = e.message
  }
}
if (route.params.id) loadExistingDraft(route.params.id)

/** Черновик создаётся при первом действии — брошенная страница не оставляет мусора. */
async function ensureDraft() {
  if (draft.value) return draft.value
  draft.value = await inventories.create({
    docDate: header.docDate,
    note: header.note || null,
    category: header.categoryId ? iri('categories', header.categoryId) : null,
  })
  return draft.value
}

/**
 * Массовое заполнение: бэкенд сам добирает товары с остатком и снимает учётное количество
 * на этот момент. Уже введённый факт не затирается, поэтому кнопку можно жать повторно —
 * например, после того как посчитали одну категорию и перешли к следующей.
 */
async function fill() {
  filling.value = true
  error.value = ''
  try {
    const inventory = await ensureDraft()
    const filled = await fillInventory(inventory.id, {
      category: header.categoryId ? Number(header.categoryId) : null,
      includeZeroStock: false,
    })
    items.value = filled.items ?? []
    if (items.value.length === 0) toast.success('Товаров с остатком не нашлось')
  } catch (e) {
    error.value = e.message
  } finally {
    filling.value = false
  }
}

/** Один товар — одна строка; уже добавленные убираем из подсказок комбобокса. */
const usedProductIds = computed(() => items.value.map((i) => String(idFromIri(i.product))))

async function addItem() {
  if (!line.productId) return
  addingItem.value = true
  error.value = ''
  try {
    const inventory = await ensureDraft()
    const created = await inventoryItems.create({
      inventory: iri('inventories', inventory.id),
      product: iri('products', line.productId),
      actualQty: null,
    })
    items.value.push({ ...created, product: selectedProduct.value })

    line.productId = ''
    selectedProduct.value = null
  } catch (e) {
    error.value = e.message
  } finally {
    addingItem.value = false
  }
}

/**
 * Факт уходит на сервер сразу после ввода. Пустое поле означает «не считали» и остаётся
 * null — это не то же самое, что посчитанный ноль, и провести документ с ним нельзя.
 */
async function saveActual(item, value) {
  const actualQty = value === '' || value === null ? null : String(value)
  if (actualQty !== null && Number(actualQty) < 0) return

  error.value = ''
  try {
    const updated = await inventoryItems.update(item.id, { actualQty })
    item.actualQty = updated.actualQty
    item.diffQty = updated.diffQty
  } catch (e) {
    error.value = e.message
  }
}

async function removeItem(item) {
  try {
    await inventoryItems.remove(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch (e) {
    error.value = e.message
  }
}

const productName = (v) => v?.name ?? '—'

const diffOf = (item) => (item.actualQty === null || item.actualQty === undefined ? null : Number(item.actualQty) - Number(item.expectedQty))
function diffClass(item) {
  const d = diffOf(item)
  if (d === null) return 'text-slate-400 dark:text-slate-500'
  if (d > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (d < 0) return 'text-red-600 dark:text-red-400'
  return 'text-slate-400 dark:text-slate-500'
}
function diffText(item) {
  const d = diffOf(item)
  if (d === null) return '—'
  return (d > 0 ? '+' : '') + qty(d)
}

const uncounted = computed(() => items.value.filter((i) => i.actualQty === null || i.actualQty === undefined).length)
const diffCount = computed(() => items.value.filter((i) => (diffOf(i) ?? 0) !== 0).length)
const canPost = computed(() => !!draft.value && items.value.length > 0 && uncounted.value === 0)

/** Проводит владелец: продавец видит документ, но кнопки у него нет. */
async function post() {
  if (!canPost.value) return
  posting.value = true
  error.value = ''
  try {
    await changeInventoryStatus(draft.value.id, 'posted')
    toast.success(`${draft.value.number} проведено`)
    router.push('/inventories?doc=' + draft.value.id)
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
      <div class="order-2 flex min-w-0 flex-col gap-6 xl:order-1 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad shrink-0 rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <h2 class="mb-5 text-sm font-semibold text-slate-800 dark:text-slate-100">Добавить товар вручную</h2>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="min-w-0 flex-1">
              <label class="label">Товар</label>
              <ProductCombobox
                v-model="line.productId"
                :exclude-ids="usedProductIds"
                @select="selectedProduct = $event"
              />
            </div>
            <div class="shrink-0">
              <button class="btn-primary w-full sm:w-auto" :disabled="!line.productId || addingItem" @click="addItem">
                <AppIcon name="plus" :size="16" /> Добавить
              </button>
            </div>
          </div>
        </section>

        <section class="card flex flex-1 flex-col overflow-hidden rounded-2xl shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div v-if="items.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
            <div v-for="i in items" :key="i.id" class="p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
                  <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">по учёту {{ qty(i.expectedQty) }}</div>
                </div>
                <button class="btn-ghost btn-sm shrink-0" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
              </div>
              <div class="mt-2 flex items-center gap-3">
                <input
                  :value="i.actualQty"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="факт"
                  class="input w-32"
                  @change="saveActual(i, $event.target.value)"
                />
                <span class="tabnum text-sm font-semibold" :class="diffClass(i)">{{ diffText(i) }}</span>
              </div>
            </div>
          </div>

          <div v-if="items.length" class="hidden overflow-x-auto sm:block">
            <table class="w-full min-w-[520px]">
              <thead>
                <tr>
                  <th class="th">Товар</th>
                  <th class="th">По учёту</th>
                  <th class="th">Факт</th>
                  <th class="th">Расхождение</th>
                  <th class="th"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in items" :key="i.id" class="table-row">
                  <td class="td">{{ productName(i.product) }}</td>
                  <td class="td tabnum text-slate-500 dark:text-slate-400">{{ qty(i.expectedQty) }}</td>
                  <td class="td">
                    <input
                      :value="i.actualQty"
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="—"
                      class="input w-28"
                      @change="saveActual(i, $event.target.value)"
                    />
                  </td>
                  <td class="td tabnum font-semibold" :class="diffClass(i)">{{ diffText(i) }}</td>
                  <td class="td text-right">
                    <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="flex flex-1 items-center justify-center">
            <EmptyState icon="check" title="Строк пока нет" text="Заполните по остаткам или добавьте товары вручную" />
          </div>
        </section>
      </div>

      <aside class="order-1 flex flex-col xl:order-2 xl:sticky xl:top-20 xl:min-h-[calc(100vh-7rem)]">
        <section class="card-pad flex flex-1 flex-col rounded-2xl p-6 shadow-sm dark:shadow-lg dark:shadow-black/20">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Новая инвентаризация</h2>
            <span v-if="draft" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ draft.number }}</span>
          </div>

          <div class="mt-5 space-y-5">
            <div>
              <label class="label">Дата</label>
              <input v-model="header.docDate" type="date" class="input" :disabled="!!draft" />
            </div>
            <div>
              <label class="label">Категория</label>
              <select v-model="header.categoryId" class="input" :disabled="!!draft">
                <option value="">Весь склад</option>
                <option v-for="c in categoryOptions" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
              </select>
            </div>
            <div>
              <label class="label">Примечание</label>
              <input v-model="header.note" type="text" class="input" :disabled="!!draft" placeholder="необязательно" />
            </div>
            <button class="btn-ghost w-full" :disabled="filling" @click="fill">
              <AppIcon name="refresh" :size="16" /> Заполнить по остаткам
            </button>
          </div>

          <div class="mt-auto hidden space-y-3 border-t border-slate-300 pt-5 xl:block dark:border-slate-800">
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-500 dark:text-slate-400">Не посчитано</span>
              <span class="tabnum font-semibold" :class="uncounted ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'">{{ uncounted }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-500 dark:text-slate-400">С расхождением</span>
              <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ diffCount }}</span>
            </div>
            <button v-if="auth.can('inventories.post')" class="btn-primary w-full" :disabled="!canPost || posting" @click="post">
              Провести инвентаризацию
            </button>
            <p v-else class="text-xs text-slate-500 dark:text-slate-400">
              Проводит владелец. Заполните факт по всем строкам и передайте документ.
            </p>
          </div>
        </section>
      </aside>
    </div>

    <div
      class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-slate-300 bg-white/95 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:left-[248px] xl:hidden"
    >
      <div class="flex items-center justify-between text-sm">
        <span class="text-slate-500 dark:text-slate-400">Не посчитано</span>
        <span class="tabnum font-semibold" :class="uncounted ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'">{{ uncounted }}</span>
      </div>
      <button v-if="auth.can('inventories.post')" class="btn-primary w-full" :disabled="!canPost || posting" @click="post">
        Провести инвентаризацию
      </button>
      <p v-else class="text-xs text-slate-500 dark:text-slate-400">
        Проводит владелец. Заполните факт по всем строкам и передайте документ.
      </p>
    </div>
  </div>
</template>
