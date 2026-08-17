<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import { priceOrDash, qty, unitLabel } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'
import { categories, products } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const auth = useAuthStore()
const confirmStore = useConfirmStore()

const UNITS = ['kg', 'l', 'pcs']

const categoryList = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const categoryFilter = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const withStock = (p) => ({ ...p, stock: p.remainingQty ?? 0 })

/**
 * Поиск уходит на бэкенд (?name=...) только от 2 символов и с задержкой —
 * не гонять запрос на каждое нажатие клавиши. Короче трёх символов и без
 * фильтра — обычная постраничная загрузка без параметра поиска.
 */
const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => {
  const s = debouncedSearch.value.trim()
  return s.length >= 2 ? s : ''
})

const pageItems = ref([])
const totalItems = ref(0)
const page = ref(1)
const pageSize = 20

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize }
    if (searchQuery.value) params.name = searchQuery.value
    if (categoryFilter.value) params['category.id'] = categoryFilter.value
    const { items, totalItems: total } = await api.getPage('/products', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const blank = () => ({
  id: null,
  sku: '',
  name: '',
  category: '',
  currency: 'USD',
  unit: 'kg',
  minStock: 10,
  priceUsd: null,
  priceUzs: null,
  isActive: true,
})
const form = reactive(blank())

onMounted(async () => {
  categoryList.value = await categories.list().catch((e) => {
    error.value = e.message
    return []
  })
  await loadPage(1)
})

const categoryName = (categoryValue) => {
  const id = idFromIri(categoryValue)
  return categoryList.value.find((c) => String(c.id) === String(id))?.name ?? '—'
}

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))
const paged = computed(() => pageItems.value.map(withStock))

watch([searchQuery, categoryFilter], () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))

function openNew() {
  Object.assign(form, blank())
  formError.value = ''
  modal.value = true
}
function openEdit(p) {
  Object.assign(form, {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: idFromIri(p.category) ?? '',
    currency: p.currency,
    unit: p.unit,
    minStock: Number(p.minStock),
    priceUsd: p.priceUsd !== null && p.priceUsd !== undefined ? Number(p.priceUsd) : null,
    priceUzs: p.priceUzs !== null && p.priceUzs !== undefined ? Number(p.priceUzs) : null,
    isActive: p.isActive,
  })
  formError.value = ''
  modal.value = true
}

const valid = computed(() => form.name.trim() && form.sku.trim() && form.category)

async function save() {
  if (!valid.value) return
  saving.value = true
  formError.value = ''
  const payload = {
    sku: form.sku.trim(),
    name: form.name.trim(),
    category: iri('categories', form.category),
    currency: form.currency,
    unit: form.unit,
    minStock: String(form.minStock),
    priceUsd: form.priceUsd === null || form.priceUsd === '' ? null : String(form.priceUsd),
    priceUzs: form.priceUzs === null || form.priceUzs === '' ? null : String(form.priceUzs),
    isActive: form.isActive,
  }
  try {
    if (form.id) await products.update(form.id, payload)
    else await products.create(payload)
    modal.value = false
    await loadPage(page.value)
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove(p) {
  if (!(await confirmStore.ask(`Удалить товар «${p.name}»?`))) return
  try {
    await products.remove(p.id)
    await loadPage(page.value)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по названию" />
      <select v-model="categoryFilter" class="input max-w-[180px]">
        <option value="">Все категории</option>
        <option v-for="c in categoryList" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
      </select>
      <button v-if="auth.can('products.edit')" class="btn-primary btn-sm ml-auto" @click="openNew">
        <AppIcon name="plus" :size="16" /> Новый товар
      </button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !paged.length" />
      <table v-if="paged.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Товар</th>
            <th class="th">Категория</th>
            <th class="th">Ед.</th>
            <th class="th">Продажа</th>
            <th class="th">Остаток</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in paged" :key="p.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/products/${p.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">{{ p.name }}</RouterLink>
              <div class="text-xs text-slate-400 dark:text-slate-500">{{ p.sku }}</div>
            </td>
            <td class="td text-slate-500 dark:text-slate-400">{{ categoryName(p.category) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ unitLabel(p.unit) }}</td>
            <td class="td tabnum">{{ priceOrDash(p.priceUsd, 'USD') }} $ / {{ priceOrDash(p.priceUzs, 'UZS') }} сум</td>
            <td class="td tabnum">{{ qty(p.stock) }} {{ unitLabel(p.unit) }}</td>
            <td class="td text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-1.5">
                <button v-if="auth.can('products.edit')" class="btn-ghost btn-sm" @click="openEdit(p)">
                  <AppIcon name="edit" :size="14" />
                </button>
                <button v-if="auth.can('products.edit')" class="btn-ghost btn-sm" title="Удалить товар" @click="remove(p)">
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="divide-y divide-slate-200 sm:hidden">
        <div v-for="p in paged" :key="p.id" class="flex items-start gap-2 px-4 py-3">
          <RouterLink :to="`/products/${p.id}`" class="block min-w-0 flex-1">
            <div class="font-medium text-slate-800 dark:text-slate-100">{{ p.name }}</div>
            <div class="mt-0.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{{ p.sku }} · {{ categoryName(p.category) }}</span>
              <span class="tabnum">{{ qty(p.stock) }} {{ unitLabel(p.unit) }}</span>
            </div>
          </RouterLink>
          <div v-if="auth.can('products.edit')" class="flex shrink-0 items-center gap-1.5">
            <button class="btn-ghost btn-sm" title="Изменить товар" @click="openEdit(p)">
              <AppIcon name="edit" :size="14" />
            </button>
            <button class="btn-ghost btn-sm" title="Удалить товар" @click="remove(p)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </div>

      <EmptyState v-if="!paged.length && !loading" icon="tag" title="Товары не найдены" />

      <Pagination
        :page="page"
        :total-pages="totalPages"
        :total-items="totalItems"
        :page-size="pageSize"
        @update:page="page = $event"
      />
    </div>

    <ModalDialog v-if="modal" :title="form.id ? 'Товар' : 'Новый товар'" @close="modal = false">
      <div class="space-y-3">
        <div>
          <label class="label">Наименование</label>
          <input v-model="form.name" class="input" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Артикул</label>
            <input v-model="form.sku" class="input" />
          </div>
          <div>
            <label class="label">Категория</label>
            <select v-model="form.category" class="input">
              <option value="" disabled>Выберите</option>
              <option v-for="c in categoryList" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Единица учёта</label>
            <select v-model="form.unit" class="input">
              <option v-for="u in UNITS" :key="u" :value="u">{{ unitLabel(u) }}</option>
            </select>
          </div>
          <div>
            <label class="label">Минимальный остаток</label>
            <input v-model="form.minStock" type="number" step="0.001" class="input" />
          </div>
        </div>
        <div>
          <label class="label">Основная валюта</label>
          <div class="flex gap-2">
            <button
              type="button"
              v-for="c in ['USD', 'UZS']"
              :key="c"
              class="btn-ghost btn-sm flex-1"
              :class="{ 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300': form.currency === c }"
              @click="form.currency = c"
            >
              {{ c }}
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Цена продажи, $</label>
            <input v-model="form.priceUsd" type="number" step="0.01" class="input" placeholder="необязательно" />
          </div>
          <div>
            <label class="label">Цена продажи, сум</label>
            <input v-model="form.priceUzs" type="number" step="1000" class="input" placeholder="необязательно" />
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300 bg-white text-indigo-600 dark:border-slate-700 dark:bg-slate-800" />
          Активен
        </label>
        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">Отмена</button>
        <button class="btn-primary" :disabled="saving || !valid" @click="save">Сохранить</button>
      </template>
    </ModalDialog>
  </div>
</template>
