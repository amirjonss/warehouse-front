<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date, money } from '@/utils/format'
import { receiptItems, receipts, suppliers, products } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const route = useRoute()

const list = ref([])
const supplierList = ref([])
const productList = ref([])
const itemsByReceipt = ref(new Map())
const loading = ref(true)
const error = ref('')
const search = ref('')
const supplierFilter = ref('')
const opened = ref(null)

const STATUS = { draft: 'черновик', posted: 'проведено', cancelled: 'отменено' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [r, s, p, items] = await Promise.all([
      receipts.list(),
      suppliers.list(),
      products.list(),
      receiptItems.list(),
    ])
    list.value = r.sort((a, b) => b.docDate.localeCompare(a.docDate))
    supplierList.value = s
    productList.value = p
    const map = new Map()
    for (const it of items) {
      const rid = idFromIri(it.receipt)
      if (!map.has(rid)) map.set(rid, [])
      map.get(rid).push(it)
    }
    itemsByReceipt.value = map

    if (route.query.doc) {
      opened.value = list.value.find((x) => String(x.id) === String(route.query.doc)) ?? null
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const supplierName = (v) => supplierList.value.find((s) => String(s.id) === String(idFromIri(v)))?.name ?? '—'
const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'

const filtered = computed(() =>
  list.value
    .filter((r) => !supplierFilter.value || idFromIri(r.supplier) === String(supplierFilter.value))
    .filter((r) => `${r.number} ${supplierName(r.supplier)}`.toLowerCase().includes(search.value.toLowerCase())),
)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по номеру/поставщику" />
      <select v-model="supplierFilter" class="input max-w-[200px]">
        <option value="">Все поставщики</option>
        <option v-for="s in supplierList" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
      </select>
      <RouterLink to="/receipts/new" class="btn-primary btn-sm ml-auto">Новый приход</RouterLink>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div class="card overflow-hidden">
      <table v-if="filtered.length" class="w-full">
        <thead>
          <tr>
            <th class="th">Номер</th>
            <th class="th">Дата</th>
            <th class="th">Поставщик</th>
            <th class="th">Сумма</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" class="table-row">
            <td class="td font-medium text-slate-800">{{ r.number }}</td>
            <td class="td text-slate-500">{{ date(r.docDate) }}</td>
            <td class="td text-slate-600">{{ supplierName(r.supplier) }}</td>
            <td class="td tabnum">
              <template v-if="Number(r.totalUsd) > 0">{{ money(r.totalUsd, 'USD') }}</template>
              <template v-if="Number(r.totalUsd) > 0 && Number(r.totalUzs) > 0"> + </template>
              <template v-if="Number(r.totalUzs) > 0">{{ money(r.totalUzs, 'UZS') }}</template>
            </td>
            <td class="td"><span class="badge bg-slate-100 text-slate-600">{{ STATUS[r.status] }}</span></td>
            <td class="td text-right">
              <button class="btn-ghost btn-sm" @click="opened = r">Открыть</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="receipt" title="Приходов пока нет" />
    </div>

    <ModalDialog v-if="opened" :title="opened.number" :subtitle="date(opened.docDate) + ' · ' + supplierName(opened.supplier)" @close="opened = null">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-slate-500">
            <th class="pb-2">Товар</th>
            <th class="pb-2">Кол-во</th>
            <th class="pb-2">Цена</th>
            <th class="pb-2">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itemsByReceipt.get(String(opened.id)) ?? []" :key="i.id" class="border-t border-slate-100">
            <td class="py-1.5">{{ productName(i.product) }}</td>
            <td class="py-1.5 tabnum">{{ i.quantity }}</td>
            <td class="py-1.5 tabnum">{{ i.price }} {{ i.currency }}</td>
            <td class="py-1.5 tabnum">{{ money(i.total, i.currency) }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
      </template>
    </ModalDialog>
  </div>
</template>
