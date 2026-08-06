<script setup>
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { dateTime, qty, toISODate } from '@/utils/format'
import { batches, products, stockMovements } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const list = ref([])
const productList = ref([])
const batchList = ref([])
const loading = ref(true)
const error = ref('')

const search = ref('')
const type = ref('')
const from = ref('')
const to = ref('')
const limit = ref(60)

const TYPE = {
  in: { label: 'Приход', cls: 'bg-emerald-100 text-emerald-700' },
  out: { label: 'Продажа', cls: 'bg-blue-100 text-blue-700' },
  writeoff: { label: 'Списание', cls: 'bg-red-100 text-red-700' },
  adjust: { label: 'Корректировка', cls: 'bg-slate-100 text-slate-600' },
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [m, p, b] = await Promise.all([stockMovements.list(), products.list(), batches.list()])
    list.value = m.sort((a, b2) => b2.occurredAt.localeCompare(a.occurredAt))
    productList.value = p
    batchList.value = b
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'
const batchNumber = (v) => batchList.value.find((b) => String(b.id) === String(idFromIri(v)))?.number ?? '—'

const filtered = computed(() =>
  list.value
    .filter((m) => !type.value || m.type === type.value)
    .filter((m) => !from.value || m.occurredAt.slice(0, 10) >= from.value)
    .filter((m) => !to.value || m.occurredAt.slice(0, 10) <= to.value)
    .filter((m) => `${m.docNumber} ${productName(m.product)}`.toLowerCase().includes(search.value.toLowerCase())),
)
const shown = computed(() => filtered.value.slice(0, limit.value))

function resetFilters() {
  search.value = ''
  type.value = ''
  from.value = ''
  to.value = ''
}
function setToday() {
  from.value = toISODate()
  to.value = toISODate()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по документу/товару" />
      <select v-model="type" class="input max-w-[160px]">
        <option value="">Все операции</option>
        <option value="in">Приход</option>
        <option value="out">Продажа</option>
        <option value="writeoff">Списание</option>
        <option value="adjust">Корректировка</option>
      </select>
      <input v-model="from" type="date" class="input max-w-[150px]" />
      <input v-model="to" type="date" class="input max-w-[150px]" />
      <button class="btn-ghost btn-sm" @click="setToday">Сегодня</button>
      <button class="btn-ghost btn-sm" @click="resetFilters">Сбросить</button>
      <span class="ml-auto text-sm text-slate-500">Найдено: {{ filtered.length }}</span>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div class="card overflow-hidden">
      <table v-if="shown.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Дата и время</th>
            <th class="th">Операция</th>
            <th class="th">Документ</th>
            <th class="th">Товар</th>
            <th class="th">Партия</th>
            <th class="th">Кол-во</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in shown" :key="m.id" class="table-row">
            <td class="td text-slate-500">{{ dateTime(m.occurredAt) }}</td>
            <td class="td"><span class="badge" :class="TYPE[m.type]?.cls">{{ TYPE[m.type]?.label ?? m.type }}</span></td>
            <td class="td text-slate-600">{{ m.docNumber }}</td>
            <td class="td text-slate-700">{{ productName(m.product) }}</td>
            <td class="td text-slate-500">{{ batchNumber(m.batch) }}</td>
            <td class="td tabnum font-medium" :class="Number(m.quantity) < 0 ? 'text-red-600' : 'text-emerald-600'">
              {{ Number(m.quantity) > 0 ? '+' : '' }}{{ qty(m.quantity) }}
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="list" title="Движений не найдено" />
    </div>

    <button v-if="shown.length < filtered.length" class="btn-ghost w-full" @click="limit += 60">
      Показать ещё ({{ filtered.length - shown.length }})
    </button>
  </div>
</template>
