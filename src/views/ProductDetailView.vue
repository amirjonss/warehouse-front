<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { date, dateTime, qty, unitLabel } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { batches, categories, products, stockMovements } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const product = ref(null)
const categoryList = ref([])
const productBatches = ref([])
const movements = ref([])
const loading = ref(true)
const error = ref('')

const MOVE = {
  in: { label: 'Приход', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400', sign: '+' },
  out: { label: 'Продажа', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400', sign: '-' },
  writeoff: { label: 'Списание', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400', sign: '-' },
  adjust: { label: 'Корректировка', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400', sign: '' },
}

const categoryName = (v) => categoryList.value.find((c) => String(c.id) === String(idFromIri(v)))?.name ?? '—'

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [p, catList] = await Promise.all([products.get(route.params.id), categories.list()])
    product.value = p
    categoryList.value = catList

    if (auth.can('batches')) {
      const allBatches = await batches.list()
      productBatches.value = allBatches
        .filter((b) => String(idFromIri(b.product?.['@id'])) === String(p.id))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    }
    if (auth.can('movements')) {
      const allMovements = await stockMovements.list()
      movements.value = allMovements
        .filter((m) => String(idFromIri(m.product)) === String(p.id))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 30)
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Остаток уже приходит в самой партии — пересчитывать через движения не нужно. */
const remainingQty = (batch) => Number(batch.remainingQty)
</script>

<template>
  <div v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>
  <p v-else-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
  <div v-else-if="product" class="space-y-4">
    <button class="btn-ghost btn-sm" @click="router.back()">
      <AppIcon name="chevronLeft" :size="16" /> Назад
    </button>

    <div class="card-pad">
      <div class="text-lg font-semibold text-slate-800 dark:text-slate-100">{{ product.name }}</div>
      <div class="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {{ product.sku }} · {{ categoryName(product.category) }}
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Мин. остаток</div>
        <div class="mt-1 text-lg font-semibold tabnum">{{ qty(product.minStock) }} {{ unitLabel(product.unit) }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500 dark:text-slate-400">Цена продажи</div>
        <div class="mt-1 text-lg font-semibold tabnum">
          {{ product.priceUsd ?? '—' }} $ / {{ product.priceUzs ?? '—' }} сум
        </div>
      </div>
    </div>

    <div v-if="auth.can('batches')" class="card overflow-hidden">
      <div class="border-b border-slate-100 dark:border-slate-800 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Партии</div>
      <div v-if="productBatches.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div
          v-for="b in productBatches"
          :key="b.id"
          class="p-4"
          :class="{ 'opacity-45': remainingQty(b) <= 0 }"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-slate-800 dark:text-slate-100">{{ b.number }}</span>
            <span class="tabnum text-sm text-slate-700 dark:text-slate-300">{{ qty(remainingQty(b)) }} из {{ qty(b.initialQty) }}</span>
          </div>
          <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ date(b.receivedAt) }} · {{ (b.supplier?.name ?? "—") }}</div>
          <div class="mt-0.5 tabnum text-xs text-slate-400 dark:text-slate-500">{{ b.purchasePrice }} {{ b.currency }}</div>
        </div>
      </div>

      <table v-if="productBatches.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Партия</th>
            <th class="th">Принято</th>
            <th class="th">Остаток</th>
            <th class="th">Себестоимость</th>
            <th class="th">Поставщик</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in productBatches" :key="b.id" class="table-row" :class="{ 'opacity-45': remainingQty(b) <= 0 }">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ b.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(b.receivedAt) }}</td>
            <td class="td tabnum">{{ qty(remainingQty(b)) }} из {{ qty(b.initialQty) }}</td>
            <td class="td tabnum">{{ b.purchasePrice }} {{ b.currency }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ (b.supplier?.name ?? "—") }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="layers" title="Партий пока нет" />
    </div>

    <div v-if="auth.can('movements')" class="card overflow-hidden">
      <div class="border-b border-slate-100 dark:border-slate-800 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">История движений</div>
      <div v-if="movements.length" class="divide-y divide-slate-100">
        <div v-for="m in movements" :key="m.id" class="flex items-center gap-3 px-4 py-2.5">
          <span class="badge shrink-0" :class="MOVE[m.type]?.cls">{{ MOVE[m.type]?.label ?? m.type }}</span>
          <span class="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-400">{{ m.docNumber }}</span>
          <span class="shrink-0 text-xs text-slate-400 dark:text-slate-500">{{ dateTime(m.occurredAt) }}</span>
          <span class="tabnum shrink-0 text-sm font-medium">{{ MOVE[m.type]?.sign }}{{ qty(Math.abs(m.quantity)) }}</span>
        </div>
      </div>
      <EmptyState v-else icon="list" title="Движений пока нет" />
    </div>
  </div>
</template>
