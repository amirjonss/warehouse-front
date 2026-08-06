<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import { qty, stockStatus, unitLabel, date } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { batches, products, productStock, stockMovements, suppliers } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const route = useRoute()
const auth = useAuthStore()

const tab = ref(route.query.tab === 'batches' ? 'batches' : 'products')
const search = ref('')
const onlyLow = ref(false)

const rows = ref([])
const batchRows = ref([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [stockList, productList] = await Promise.all([productStock(), products.list()])
    const productById = new Map(productList.map((p) => [String(p.id), p]))
    rows.value = stockList.map((s) => ({
      ...s,
      minStock: Number(productById.get(String(s.id))?.minStock ?? 0),
      unit: productById.get(String(s.id))?.unit ?? 'pcs',
    }))

    if (auth.can('batches')) {
      const [allBatches, allMovements, allSuppliers] = await Promise.all([
        batches.list(),
        stockMovements.list(),
        suppliers.list(),
      ])
      const remainingByBatch = new Map()
      for (const m of allMovements) {
        const id = idFromIri(m.batch)
        remainingByBatch.set(id, (remainingByBatch.get(id) ?? 0) + Number(m.quantity))
      }
      const supplierById = new Map(allSuppliers.map((s) => [String(s.id), s]))
      batchRows.value = allBatches
        .map((b) => ({
          ...b,
          stock: remainingByBatch.get(String(b.id)) ?? 0,
          productName: productById.get(String(idFromIri(b.product)))?.name ?? '—',
          supplierName: supplierById.get(String(idFromIri(b.supplier)))?.name ?? '—',
        }))
        .filter((b) => b.stock > 0)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filteredProducts = computed(() =>
  rows.value
    .filter((r) => !onlyLow.value || Number(r.remainingQty) <= r.minStock)
    .filter((r) => `${r.name} ${r.sku}`.toLowerCase().includes(search.value.toLowerCase())),
)
const filteredBatches = computed(() =>
  batchRows.value.filter((b) => `${b.productName} ${b.number}`.toLowerCase().includes(search.value.toLowerCase())),
)

const totals = computed(() => ({
  positions: rows.value.filter((r) => Number(r.remainingQty) > 0).length,
  low: rows.value.filter((r) => Number(r.remainingQty) <= r.minStock).length,
}))
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="card-pad">
        <div class="text-xs text-slate-500">Позиций в наличии</div>
        <div class="mt-1 text-lg font-semibold">{{ totals.positions }}</div>
      </div>
      <div class="card-pad cursor-pointer" @click="tab = 'products'; onlyLow = true">
        <div class="text-xs text-slate-500">На исходе</div>
        <div class="mt-1 text-lg font-semibold" :class="totals.low ? 'text-amber-600' : ''">{{ totals.low }}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-lg bg-slate-100 p-1">
        <button class="rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'products' ? 'bg-white shadow-sm' : 'text-slate-500'" @click="tab = 'products'">
          По товарам
        </button>
        <button v-if="auth.can('batches')" class="rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'batches' ? 'bg-white shadow-sm' : 'text-slate-500'" @click="tab = 'batches'">
          По партиям
        </button>
      </div>
      <input v-model="search" class="input max-w-xs" placeholder="Поиск" />
      <label v-if="tab === 'products'" class="flex items-center gap-1.5 text-sm text-slate-600">
        <input v-model="onlyLow" type="checkbox" class="h-4 w-4 rounded border-slate-300" /> Только на исходе
      </label>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div v-if="tab === 'products'" class="card overflow-hidden">
      <table v-if="filteredProducts.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Товар</th>
            <th class="th">Остаток</th>
            <th class="th">Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredProducts" :key="r.id" class="table-row">
            <td class="td">
              <RouterLink :to="`/products/${r.id}`" class="font-medium text-slate-800 hover:text-blue-600">{{ r.name }}</RouterLink>
              <div class="text-xs text-slate-400">{{ r.sku }}</div>
            </td>
            <td class="td tabnum">{{ qty(r.remainingQty) }} {{ unitLabel(r.unit) }}</td>
            <td class="td">
              <span class="badge" :class="stockStatus(Number(r.remainingQty), r.minStock).cls">
                {{ stockStatus(Number(r.remainingQty), r.minStock).label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="boxes" title="Ничего не найдено" />
    </div>

    <div v-else class="card overflow-hidden">
      <table v-if="filteredBatches.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Партия</th>
            <th class="th">Товар</th>
            <th class="th">Принято</th>
            <th class="th">Осталось</th>
            <th v-if="auth.can('prices.purchase')" class="th">Себестоимость</th>
            <th class="th">Поставщик</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in filteredBatches" :key="b.id" class="table-row">
            <td class="td font-medium text-slate-800">{{ b.number }}</td>
            <td class="td text-slate-500">{{ b.productName }}</td>
            <td class="td text-slate-500">{{ date(b.receivedAt) }}</td>
            <td class="td tabnum">{{ qty(b.stock) }}</td>
            <td v-if="auth.can('prices.purchase')" class="td tabnum">{{ b.purchasePrice }} {{ b.currency }}</td>
            <td class="td text-slate-500">{{ b.supplierName }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="layers" title="Партий с остатком нет" />
    </div>
  </div>
</template>
