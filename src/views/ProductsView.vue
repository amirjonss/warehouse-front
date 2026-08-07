<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { unitLabel } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { categories, products, productStock } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const auth = useAuthStore()

const UNITS = ['kg', 'l', 'pcs']

const list = ref([])
const categoryList = ref([])
const stockByProduct = ref(new Map())
const loading = ref(true)
const error = ref('')
const search = ref('')
const categoryFilter = ref('')
const modal = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({
  id: null,
  sku: '',
  name: '',
  category: '',
  currency: 'USD',
  unit: 'kg',
  packQty: 1,
  packUnit: 'kg',
  minStock: 10,
  purchasePrice: 0,
  priceUsd: null,
  priceUzs: null,
  isActive: true,
})
const form = reactive(blank())

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [productList, catList, stockList] = await Promise.all([
      products.list(),
      categories.list(),
      productStock(),
    ])
    list.value = productList
    categoryList.value = catList
    stockByProduct.value = new Map(stockList.map((s) => [String(s.id), s]))
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const categoryName = (categoryValue) => {
  const id = idFromIri(categoryValue)
  return categoryList.value.find((c) => String(c.id) === String(id))?.name ?? '—'
}

const filtered = computed(() =>
  list.value
    .filter((p) => !categoryFilter.value || idFromIri(p.category) === String(categoryFilter.value))
    .filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search.value.toLowerCase()))
    .map((p) => ({ ...p, stock: stockByProduct.value.get(String(p.id))?.remainingQty ?? 0 })),
)

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
    packQty: Number(p.packQty ?? p.pack_qty ?? 1),
    packUnit: p.packUnit,
    minStock: Number(p.minStock),
    purchasePrice: p.purchasePrice !== undefined ? Number(p.purchasePrice) : 0,
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
    packQty: String(form.packQty),
    packUnit: form.packUnit,
    minStock: String(form.minStock),
    purchasePrice: String(form.purchasePrice || 0),
    priceUsd: form.priceUsd === null || form.priceUsd === '' ? null : String(form.priceUsd),
    priceUzs: form.priceUzs === null || form.priceUzs === '' ? null : String(form.priceUzs),
    isActive: form.isActive,
  }
  try {
    if (form.id) await products.update(form.id, payload)
    else await products.create(payload)
    modal.value = false
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по названию/артикулу" />
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
      <table v-if="filtered.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Товар</th>
            <th class="th">Категория</th>
            <th class="th">Упаковка</th>
            <th v-if="auth.can('prices.purchase')" class="th">Закуп</th>
            <th class="th">Продажа</th>
            <th class="th">Остаток</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/products/${p.id}`" class="font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600">{{ p.name }}</RouterLink>
              <div class="text-xs text-slate-400 dark:text-slate-500">{{ p.sku }}</div>
            </td>
            <td class="td text-slate-500 dark:text-slate-400">{{ categoryName(p.category) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">1 {{ unitLabel(p.unit) }} = {{ p.packQty ?? p.pack_qty }} {{ unitLabel(p.packUnit) }}</td>
            <td v-if="auth.can('prices.purchase')" class="td tabnum">{{ p.purchasePrice }}</td>
            <td class="td tabnum">{{ p.priceUsd ?? '—' }} $ / {{ p.priceUzs ?? '—' }} сум</td>
            <td class="td tabnum">{{ p.stock }}</td>
            <td class="td text-right">
              <button v-if="auth.can('products.edit')" class="btn-ghost btn-sm" @click="openEdit(p)">
                <AppIcon name="edit" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="divide-y divide-slate-100 sm:hidden">
        <RouterLink v-for="p in filtered" :key="p.id" :to="`/products/${p.id}`" class="block px-4 py-3">
          <div class="font-medium text-slate-800 dark:text-slate-100">{{ p.name }}</div>
          <div class="mt-0.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{{ p.sku }} · {{ categoryName(p.category) }}</span>
            <span class="tabnum">{{ p.stock }} {{ unitLabel(p.unit) }}</span>
          </div>
        </RouterLink>
      </div>

      <EmptyState v-if="!filtered.length && !loading" icon="tag" title="Товары не найдены" />
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
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="label">Единица учёта</label>
            <select v-model="form.unit" class="input">
              <option v-for="u in UNITS" :key="u" :value="u">{{ unitLabel(u) }}</option>
            </select>
          </div>
          <div>
            <label class="label">В упаковке</label>
            <input v-model="form.packQty" type="number" step="0.001" class="input" />
          </div>
          <div>
            <label class="label">Ед. упаковки</label>
            <select v-model="form.packUnit" class="input">
              <option v-for="u in UNITS" :key="u" :value="u">{{ unitLabel(u) }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="label">Минимальный остаток</label>
          <input v-model="form.minStock" type="number" step="0.001" class="input" />
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
        <div v-if="auth.can('prices.purchase')">
          <label class="label">Закупочная цена (справочно)</label>
          <input v-model="form.purchasePrice" type="number" step="0.01" class="input" />
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
