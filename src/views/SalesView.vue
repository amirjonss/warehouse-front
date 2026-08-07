<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { date, money } from '@/utils/format'
import { useConfirmStore } from '@/stores/confirm'
import { clients, debts, products, saleItems, sales } from '@/api/resources'
import { idFromIri } from '@/api/iri'

const route = useRoute()
const router = useRouter()
const confirmStore = useConfirmStore()

const list = ref([])
const clientList = ref([])
const productList = ref([])
const itemsBySale = ref(new Map())
const debtBySale = ref(new Map())
const loading = ref(true)
const error = ref('')
const search = ref('')
const from = ref('')
const to = ref('')
const opened = ref(null)

const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [s, c, p, items, allDebts] = await Promise.all([
      sales.list(),
      clients.list(),
      products.list(),
      saleItems.list(),
      debts.list(),
    ])
    list.value = s.sort((a, b) => b.docDate.localeCompare(a.docDate))
    clientList.value = c
    productList.value = p

    const itemMap = new Map()
    for (const it of items) {
      const sid = idFromIri(it.sale)
      if (!itemMap.has(sid)) itemMap.set(sid, [])
      itemMap.get(sid).push(it)
    }
    itemsBySale.value = itemMap

    const debtMap = new Map()
    for (const d of allDebts) {
      const sid = idFromIri(d.sale)
      const cur = debtMap.get(sid) ?? { USD: 0, UZS: 0 }
      cur[d.currency] += Number(d.amount)
      debtMap.set(sid, cur)
    }
    debtBySale.value = debtMap

    if (route.query.doc) opened.value = list.value.find((x) => String(x.id) === String(route.query.doc)) ?? null
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Черновик открывается на редактирование, проведённая/отменённая — в режиме просмотра. */
function open(s) {
  if (s.status === 'draft') router.push(`/sales/${s.id}/edit`)
  else opened.value = s
}

/** Удалить можно только черновик — проведённая отгрузка уже списала товар и создала долг. */
async function removeDraft(s) {
  if (!(await confirmStore.ask(`Удалить черновик «${s.number}»?`))) return
  try {
    await sales.remove(s.id)
    list.value = list.value.filter((x) => x.id !== s.id)
  } catch (e) {
    error.value = e.message
  }
}

const clientName = (v) => clientList.value.find((c) => String(c.id) === String(idFromIri(v)))?.name ?? '—'
const productName = (v) => productList.value.find((p) => String(p.id) === String(idFromIri(v)))?.name ?? '—'
const remaining = (sale) => debtBySale.value.get(String(sale.id)) ?? { USD: 0, UZS: 0 }

const filtered = computed(() =>
  list.value
    .filter((s) => !from.value || s.docDate >= from.value)
    .filter((s) => !to.value || s.docDate <= to.value)
    .filter((s) => `${s.number} ${clientName(s.customer)}`.toLowerCase().includes(search.value.toLowerCase())),
)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по номеру/клиенту" />
      <input v-model="from" type="date" class="input max-w-[150px]" />
      <input v-model="to" type="date" class="input max-w-[150px]" />
      <RouterLink to="/sales/new" class="btn-primary btn-sm ml-auto">Новая отгрузка</RouterLink>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
      <div v-if="filtered.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div
          v-for="s in filtered"
          :key="s.id"
          class="cursor-pointer p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
          @click="open(s)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ s.number }}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {{ date(s.docDate) }} · {{ clientName(s.customer) }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="badge" :class="STATUS[s.status].cls">{{ STATUS[s.status].label }}</span>
              <button
                v-if="s.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removeDraft(s)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="tabnum text-slate-700 dark:text-slate-300">
              <template v-if="Number(s.totalUsd) > 0">{{ money(s.totalUsd, 'USD') }}</template>
              <template v-if="Number(s.totalUsd) > 0 && Number(s.totalUzs) > 0"> + </template>
              <template v-if="Number(s.totalUzs) > 0">{{ money(s.totalUzs, 'UZS') }}</template>
            </span>
            <span class="tabnum text-amber-600 dark:text-amber-400">
              <template v-if="remaining(s).USD > 0">{{ money(remaining(s).USD, 'USD') }}</template>
              <template v-if="remaining(s).USD > 0 && remaining(s).UZS > 0"> + </template>
              <template v-if="remaining(s).UZS > 0">{{ money(remaining(s).UZS, 'UZS') }}</template>
              <template v-if="remaining(s).USD <= 0 && remaining(s).UZS <= 0 && s.status === 'posted'">
                <span class="text-emerald-600 dark:text-emerald-400">оплачено</span>
              </template>
            </span>
          </div>
        </div>
      </div>

      <!-- sm и выше: обычная таблица (со скроллом вбок, если не влезает) -->
      <div v-if="filtered.length" class="hidden overflow-x-auto sm:block">
      <table class="w-full">
        <thead>
          <tr>
            <th class="th">Номер</th>
            <th class="th">Дата</th>
            <th class="th">Клиент</th>
            <th class="th">Сумма</th>
            <th class="th">Долг</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id" class="table-row cursor-pointer" @click="open(s)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ s.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(s.docDate) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ clientName(s.customer) }}</td>
            <td class="td tabnum">
              <template v-if="Number(s.totalUsd) > 0">{{ money(s.totalUsd, 'USD') }}</template>
              <template v-if="Number(s.totalUsd) > 0 && Number(s.totalUzs) > 0"> + </template>
              <template v-if="Number(s.totalUzs) > 0">{{ money(s.totalUzs, 'UZS') }}</template>
            </td>
            <td class="td tabnum text-amber-600 dark:text-amber-400">
              <template v-if="remaining(s).USD > 0">{{ money(remaining(s).USD, 'USD') }}</template>
              <template v-if="remaining(s).USD > 0 && remaining(s).UZS > 0"> + </template>
              <template v-if="remaining(s).UZS > 0">{{ money(remaining(s).UZS, 'UZS') }}</template>
              <template v-if="remaining(s).USD <= 0 && remaining(s).UZS <= 0 && s.status === 'posted'">
                <span class="text-emerald-600 dark:text-emerald-400">оплачено</span>
              </template>
            </td>
            <td class="td"><span class="badge" :class="STATUS[s.status].cls">{{ STATUS[s.status].label }}</span></td>
            <td class="td text-right">
              <button
                v-if="s.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removeDraft(s)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <EmptyState v-else-if="!loading" icon="truck" title="Отгрузок пока нет" />
    </div>

    <ModalDialog v-if="opened" :title="opened.number" :subtitle="date(opened.docDate) + ' · ' + clientName(opened.customer)" @close="opened = null">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="pb-2">Товар</th>
            <th class="pb-2">Кол-во</th>
            <th class="pb-2">Цена</th>
            <th class="pb-2">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itemsBySale.get(String(opened.id)) ?? []" :key="i.id" class="border-t border-slate-100 dark:border-slate-800">
            <td class="py-1.5">{{ productName(i.product) }}</td>
            <td class="py-1.5 tabnum">{{ i.quantity }}</td>
            <td class="py-1.5 tabnum">{{ i.price }} {{ i.currency }}</td>
            <td class="py-1.5 tabnum">{{ money(i.total, i.currency) }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <RouterLink :to="`/print/sale/${opened.id}`" target="_blank" class="btn-ghost">Печать</RouterLink>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
      </template>
    </ModalDialog>
  </div>
</template>
