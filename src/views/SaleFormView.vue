<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, toISODate } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import {
  batches,
  clients,
  exchangeRates,
  products,
  saleItemAllocations,
  saleItems,
  sales,
  changeSaleStatus,
} from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const router = useRouter()
const auth = useAuthStore()

const clientList = ref([])
const productList = ref([])
const batchList = ref([])
const referenceRate = ref('')
const error = ref('')

const header = reactive({ customerId: '', docDate: toISODate(), note: '' })
const draft = ref(null)
const items = ref([])
const allocationsByItem = ref(new Map())
const creatingDraft = ref(false)
const addingItem = ref(false)
const posting = ref(false)

const line = reactive({ productId: '', quantity: 1, price: '', currency: 'USD', rate: '' })

async function load() {
  try {
    const [c, p, b, rates] = await Promise.all([
      clients.list(),
      products.list(),
      batches.list().catch(() => []),
      exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 }),
    ])
    clientList.value = c
    productList.value = p
    batchList.value = b
    referenceRate.value = rates[0]?.rateBuy ?? ''
    line.rate = referenceRate.value
  } catch (e) {
    error.value = e.message
  }
}
load()

async function createDraft() {
  if (!header.customerId) return
  creatingDraft.value = true
  error.value = ''
  try {
    draft.value = await sales.create({
      docDate: header.docDate,
      customer: iri('clients', header.customerId),
      note: header.note || '',
    })
  } catch (e) {
    error.value = e.message
  } finally {
    creatingDraft.value = false
  }
}

const availableProducts = computed(() => {
  const used = new Set(items.value.map((i) => String(idFromIri(i.product))))
  return productList.value.filter((p) => !used.has(String(p.id)))
})

function onProductChange() {
  const p = productList.value.find((x) => String(x.id) === String(line.productId))
  if (!p) return
  line.currency = p.currency
  line.price = line.currency === 'USD' ? (p.priceUsd ?? '') : (p.priceUzs ?? '')
}

const lineValid = computed(() => line.productId && Number(line.quantity) > 0 && Number(line.rate) > 0)

async function addItem() {
  if (!lineValid.value || !draft.value) return
  addingItem.value = true
  error.value = ''
  try {
    const payload = {
      sale: iri('sales', draft.value.id),
      product: iri('products', line.productId),
      quantity: String(line.quantity),
      currency: line.currency,
      rate: String(line.rate),
    }
    if (line.price !== '' && line.price !== null) payload.price = String(line.price)

    const created = await saleItems.create(payload)
    items.value.push(created)

    try {
      const allocs = await saleItemAllocations.list()
      allocationsByItem.value.set(
        String(created.id),
        allocs.filter((a) => String(idFromIri(a.saleItem)) === String(created.id)),
      )
    } catch {
      /* аллокации не критичны для продолжения */
    }

    Object.assign(line, { productId: '', quantity: 1, price: '', currency: 'USD', rate: referenceRate.value })
  } catch (e) {
    error.value = e.message
  } finally {
    addingItem.value = false
  }
}

async function removeItem(item) {
  try {
    await saleItems.remove(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch (e) {
    error.value = e.message
  }
}

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'
const batchNumber = (v) => batchList.value.find((b) => String(b.id) === String(idFromIri(v)))?.number ?? '—'

const totals = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const i of items.value) acc[i.currency] += Number(i.total)
  return acc
})

async function post() {
  if (!draft.value || items.value.length === 0) return
  posting.value = true
  error.value = ''
  try {
    await changeSaleStatus(draft.value.id, 'posted')
    router.push('/sales?doc=' + draft.value.id)
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

    <div v-if="!draft" class="card-pad space-y-3">
      <div class="text-sm font-semibold text-slate-800">Новая отгрузка</div>
      <div>
        <label class="label">Клиент</label>
        <select v-model="header.customerId" class="input">
          <option value="" disabled>Выберите клиента</option>
          <option v-for="c in clientList" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
        </select>
      </div>
      <div>
        <label class="label">Дата</label>
        <input v-model="header.docDate" type="date" class="input" />
      </div>
      <div>
        <label class="label">Примечание</label>
        <input v-model="header.note" class="input" />
      </div>
      <button class="btn-primary" :disabled="!header.customerId || creatingDraft" @click="createDraft">
        Создать черновик и добавить позиции
      </button>
    </div>

    <template v-else>
      <div class="card-pad">
        <div class="text-sm font-semibold text-slate-800">{{ draft.number }} · черновик</div>
        <div class="mt-0.5 text-xs text-slate-500">
          {{ clientList.find((c) => String(c.id) === header.customerId)?.name }} · {{ header.docDate }}
        </div>
      </div>

      <div class="card-pad space-y-3">
        <div class="text-sm font-semibold text-slate-800">Добавить позицию</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="label">Товар</label>
            <select v-model="line.productId" class="input" @change="onProductChange">
              <option value="" disabled>Выберите товар</option>
              <option v-for="p in availableProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">Количество</label>
            <input v-model="line.quantity" type="number" step="0.001" class="input" />
          </div>
          <div>
            <label class="label">Цена (необязательно)</label>
            <input v-model="line.price" type="number" step="0.01" class="input" placeholder="по умолчанию товара" />
          </div>
          <div>
            <label class="label">Валюта</label>
            <div class="flex gap-2">
              <button
                type="button"
                v-for="c in ['USD', 'UZS']"
                :key="c"
                class="btn-ghost btn-sm flex-1"
                :class="{ 'border-blue-500 bg-blue-50 text-blue-700': line.currency === c }"
                @click="line.currency = c"
              >
                {{ c }}
              </button>
            </div>
          </div>
          <div>
            <label class="label">Курс</label>
            <input v-model="line.rate" type="number" step="0.0001" class="input" />
          </div>
        </div>
        <button class="btn-ghost w-full" :disabled="!lineValid || addingItem" @click="addItem">
          <AppIcon name="plus" :size="16" /> Добавить в отгрузку
        </button>
      </div>

      <div class="card overflow-hidden">
        <table v-if="items.length" class="w-full">
          <thead>
            <tr>
              <th class="th">Товар</th>
              <th class="th">Кол-во</th>
              <th class="th">Цена</th>
              <th class="th">Сумма</th>
              <th class="th">Списано с батчей</th>
              <th class="th"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in items" :key="i.id" class="table-row">
              <td class="td">{{ productName(i.product) }}</td>
              <td class="td tabnum">{{ i.quantity }}</td>
              <td class="td tabnum">{{ i.price }} {{ i.currency }}</td>
              <td class="td tabnum">{{ money(i.total, i.currency) }}</td>
              <td class="td text-xs text-slate-500">
                <div v-for="a in allocationsByItem.get(String(i.id)) ?? []" :key="a.id">
                  {{ batchNumber(a.batch) }}: {{ a.quantity }}
                </div>
              </td>
              <td class="td text-right">
                <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else icon="truck" title="Позиций пока нет" text="Добавьте хотя бы одну строку" />
      </div>

      <div class="card-pad flex items-center justify-between">
        <div class="text-sm text-slate-500">
          Итого:
          <span class="tabnum font-semibold text-slate-800">
            <template v-if="totals.USD > 0">{{ money(totals.USD, 'USD') }}</template>
            <template v-if="totals.USD > 0 && totals.UZS > 0"> + </template>
            <template v-if="totals.UZS > 0">{{ money(totals.UZS, 'UZS') }}</template>
            <template v-if="totals.USD <= 0 && totals.UZS <= 0">0</template>
          </span>
        </div>
        <button class="btn-primary" :disabled="items.length === 0 || posting" @click="post">Провести отгрузку</button>
      </div>
    </template>
  </div>
</template>
