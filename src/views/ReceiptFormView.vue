<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, toISODate } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'
import { exchangeRates, products, receiptItems, receipts, suppliers, changeReceiptStatus } from '@/api/resources'
import { iri, idFromIri } from '@/api/iri'

const router = useRouter()
const auth = useAuthStore()

const supplierList = ref([])
const productList = ref([])
const referenceRate = ref('')
const loading = ref(true)
const error = ref('')

const header = reactive({ supplierId: '', docDate: toISODate(), note: '' })
const draft = ref(null) // созданный черновик Receipt
const items = ref([])
const creatingDraft = ref(false)
const posting = ref(false)

const line = reactive({ productId: '', quantity: 10, price: 0, currency: 'USD', rate: '' })

async function load() {
  loading.value = true
  try {
    const [s, p, rates] = await Promise.all([
      suppliers.list(),
      products.list(),
      exchangeRates.list({ 'order[rateDate]': 'desc', itemsPerPage: 1 }),
    ])
    supplierList.value = s
    productList.value = p
    referenceRate.value = rates[0]?.rateBuy ?? ''
    line.rate = referenceRate.value
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
load()

async function createDraft() {
  if (!header.supplierId) return
  creatingDraft.value = true
  error.value = ''
  try {
    draft.value = await receipts.create({
      docDate: header.docDate,
      supplier: iri('suppliers', header.supplierId),
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

const lineValid = computed(() => line.productId && Number(line.quantity) > 0 && Number(line.price) > 0 && Number(line.rate) > 0)

async function addItem() {
  if (!lineValid.value || !draft.value) return
  error.value = ''
  try {
    const created = await receiptItems.create({
      receipt: iri('receipts', draft.value.id),
      product: iri('products', line.productId),
      quantity: String(line.quantity),
      price: String(line.price),
      currency: line.currency,
      rate: line.currency === 'UZS' ? '1' : String(line.rate),
    })
    items.value.push(created)
    line.productId = ''
    line.quantity = 10
    line.price = 0
  } catch (e) {
    error.value = e.message
  }
}

async function removeItem(item) {
  try {
    await receiptItems.remove(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch (e) {
    error.value = e.message
  }
}

const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'

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
    await changeReceiptStatus(draft.value.id, 'posted')
    router.push('/receipts?doc=' + draft.value.id)
  } catch (e) {
    error.value = e.message
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div v-if="!draft" class="card-pad space-y-3">
      <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Новый приход</div>
      <div>
        <label class="label">Поставщик</label>
        <select v-model="header.supplierId" class="input">
          <option value="" disabled>Выберите поставщика</option>
          <option v-for="s in supplierList" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
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
      <button class="btn-primary" :disabled="!header.supplierId || creatingDraft" @click="createDraft">
        Создать черновик и добавить позиции
      </button>
    </div>

    <template v-else>
      <div class="card-pad">
        <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">{{ draft.number }} · черновик</div>
        <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {{ supplierList.find((s) => String(s.id) === header.supplierId)?.name }} · {{ header.docDate }}
        </div>
      </div>

      <div class="card-pad space-y-3">
        <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">Добавить позицию</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="label">Товар</label>
            <select v-model="line.productId" class="input">
              <option value="" disabled>Выберите товар</option>
              <option v-for="p in availableProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">Количество</label>
            <input v-model="line.quantity" type="number" step="0.001" class="input" />
          </div>
          <div>
            <label class="label">Цена</label>
            <input v-model="line.price" type="number" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Валюта</label>
            <div class="flex gap-2">
              <button
                type="button"
                v-for="c in ['USD', 'UZS']"
                :key="c"
                class="btn-ghost btn-sm flex-1"
                :class="{ 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300': line.currency === c }"
                @click="line.currency = c; line.rate = c === 'UZS' ? '1' : referenceRate"
              >
                {{ c }}
              </button>
            </div>
          </div>
          <div>
            <label class="label">Курс</label>
            <input v-model="line.rate" type="number" step="0.0001" class="input" :disabled="line.currency === 'UZS'" />
          </div>
        </div>
        <button class="btn-ghost w-full" :disabled="!lineValid" @click="addItem">
          <AppIcon name="plus" :size="16" /> Добавить в приход
        </button>
      </div>

      <div class="card overflow-hidden">
        <div v-if="items.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
          <div v-for="i in items" :key="i.id" class="flex items-center justify-between gap-2 p-4">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
              <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {{ i.quantity }} × {{ i.price }} {{ i.currency }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="tabnum text-sm font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</span>
              <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
            </div>
          </div>
        </div>

        <table v-if="items.length" class="hidden w-full sm:table">
          <thead>
            <tr>
              <th class="th">Товар</th>
              <th class="th">Кол-во</th>
              <th class="th">Цена</th>
              <th class="th">Сумма</th>
              <th class="th"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in items" :key="i.id" class="table-row">
              <td class="td">{{ productName(i.product) }}</td>
              <td class="td tabnum">{{ i.quantity }}</td>
              <td class="td tabnum">{{ i.price }} {{ i.currency }}</td>
              <td class="td tabnum">{{ money(i.total, i.currency) }}</td>
              <td class="td text-right">
                <button class="btn-ghost btn-sm" @click="removeItem(i)"><AppIcon name="trash" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else icon="receipt" title="Позиций пока нет" text="Добавьте хотя бы одну строку" />
      </div>

      <div class="card-pad flex items-center justify-between">
        <div class="text-sm text-slate-500 dark:text-slate-400">
          Итого:
          <span class="tabnum font-semibold text-slate-800 dark:text-slate-100">
            <template v-if="totals.USD > 0">{{ money(totals.USD, 'USD') }}</template>
            <template v-if="totals.USD > 0 && totals.UZS > 0"> + </template>
            <template v-if="totals.UZS > 0">{{ money(totals.UZS, 'UZS') }}</template>
            <template v-if="totals.USD <= 0 && totals.UZS <= 0">0</template>
          </span>
        </div>
        <button class="btn-primary" :disabled="items.length === 0 || posting" @click="post">Провести приход</button>
      </div>
    </template>
  </div>
</template>
