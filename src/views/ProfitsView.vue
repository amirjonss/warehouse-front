<script setup>
import { computed, onMounted, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import { dateTime, money } from '@/utils/format'
import { profits, products, sales } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const list = ref([])
const productList = ref([])
const saleList = ref([])
const loading = ref(true)
const error = ref('')

const TYPE = {
  realized: { label: 'Реализовано', cls: 'bg-emerald-100 text-emerald-700' },
  reversed: { label: 'Отменено', cls: 'bg-slate-100 text-slate-500' },
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [p, prod, s] = await Promise.all([profits.list(), products.list(), sales.list()])
    list.value = p.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    productList.value = prod
    saleList.value = s
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'
const saleNumber = (v) => saleList.value.find((s) => String(s.id) === String(idFromIri(v)))?.number ?? '—'

const totalByCurrency = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const p of list.value) acc[p.currency] += Number(p.profit)
  return acc
})
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="card-pad">
        <div class="text-xs text-slate-500">Прибыль, $</div>
        <div class="mt-1 tabnum text-lg font-semibold">{{ money(totalByCurrency.USD, 'USD') }}</div>
      </div>
      <div class="card-pad">
        <div class="text-xs text-slate-500">Прибыль, сум</div>
        <div class="mt-1 tabnum text-lg font-semibold">{{ money(totalByCurrency.UZS, 'UZS') }}</div>
      </div>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div class="card overflow-hidden">
      <table v-if="list.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Дата</th>
            <th class="th">Накладная</th>
            <th class="th">Товар</th>
            <th class="th">Тип</th>
            <th class="th">Прибыль</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.id" class="table-row">
            <td class="td text-slate-500">{{ dateTime(p.occurredAt) }}</td>
            <td class="td text-slate-700">{{ saleNumber(p.sale) }}</td>
            <td class="td text-slate-700">{{ productName(p.product) }}</td>
            <td class="td"><span class="badge" :class="TYPE[p.type]?.cls">{{ TYPE[p.type]?.label ?? p.type }}</span></td>
            <td class="td tabnum font-medium" :class="Number(p.profit) < 0 ? 'text-red-600' : 'text-emerald-600'">
              {{ money(p.profit, p.currency) }}
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="trendUp" title="Записей о прибыли пока нет" />
    </div>
  </div>
</template>
