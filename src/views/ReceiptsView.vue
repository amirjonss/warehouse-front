<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import { date, dualMoney, money, qty, rateFmt, rawPrice, userName } from '@/utils/format'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { api } from '@/api/client'
import { idFromIri } from '@/api/iri'
import { changeReceiptStatus, receipts, suppliers } from '@/api/resources'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirmStore = useConfirmStore()

const supplierList = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const supplierFilter = ref('')
const opened = ref(null)
const cancelling = ref(false)

const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

/** Поиск уходит на бэкенд (?number=...) только от 2 символов и с задержкой. */
const debouncedSearch = useDebouncedValue(search, 300)
const searchQuery = computed(() => {
  const s = debouncedSearch.value.trim()
  return s.length >= 2 ? s : ''
})

const page = ref(1)
const pageSize = 20
const pageItems = ref([])
const totalItems = ref(0)

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, 'order[docDate]': 'desc' }
    if (searchQuery.value) params.number = searchQuery.value
    if (supplierFilter.value) params.supplier = supplierFilter.value
    if (from.value) params['docDate[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['docDate[strictly_before]'] = dayAfter(to.value)
    const { items, totalItems: total } = await api.getPage('/receipts', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  supplierList.value = await suppliers.list().catch((e) => {
    error.value = e.message
    return []
  })
  await loadPage(1)

  if (route.query.doc) {
    try {
      opened.value = await receipts.get(route.query.doc)
    } catch {
      /* документ не нашёлся — просто не открываем модалку */
    }
  }
})

watch([searchQuery, supplierFilter, from, to], () => {
  page.value = 1
  loadPage(1)
})
watch(page, (p) => loadPage(p))

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

/** supplier приходит вложенным объектом с готовым .name — отдельный поиск по справочнику не нужен. */
const supplierName = (r) => r.supplier?.name ?? '—'
const supplierId = (r) => idFromIri(r.supplier)

function remaining(r) {
  return { usd: Number(r.outstandingUsd) || 0, uzs: Number(r.outstandingUzs) || 0 }
}
function hasOutstanding(r) {
  return remaining(r).usd > 0.004 || remaining(r).uzs > 0.004
}
function outstandingLabel(r) {
  if (r.outstandingUsd == null && r.outstandingUzs == null) return '—'
  return hasOutstanding(r) ? dualMoney(r.outstandingUsd, r.outstandingUzs) : 'оплачен'
}
/** Если по приходу уже что-то оплатили поставщику, бэк не даст его отменить. */
function isPaidToward(r) {
  if (r.outstandingUsd == null && r.outstandingUzs == null) return false
  return Number(r.totalUsd) - Number(r.outstandingUsd) > 0.004 || Number(r.totalUzs) - Number(r.outstandingUzs) > 0.004
}

/** Черновик открывается на редактирование, проведённый/отменённый — в режиме просмотра. */
async function openReceipt(r) {
  if (r.status === 'draft') {
    router.push(`/receipts/${r.id}/edit`)
    return
  }
  opened.value = null
  try {
    opened.value = await receipts.get(r.id)
  } catch (e) {
    error.value = e.message
  }
}

/** Отмена проведённого прихода возвращает партии со склада — запрещена, если из партии уже что-то списали/продали. */
async function cancelReceipt(r) {
  if (!(await confirmStore.ask(`Отменить приход «${r.number}»? Партии будут сняты со склада.`))) return
  cancelling.value = true
  error.value = ''
  try {
    await changeReceiptStatus(r.id, 'cancelled')
    await loadPage(page.value)
  } catch (e) {
    error.value = e.message
  } finally {
    // модалку закрываем в любом случае — и при успехе, и при ошибке (баннер с ошибкой показывается в списке)
    opened.value = null
    cancelling.value = false
  }
}

/** Удалить можно только черновик — проведённый приход уже изменил остатки. */
async function removeDraft(r) {
  if (!(await confirmStore.ask(`Удалить черновик «${r.number}»?`))) return
  try {
    await receipts.remove(r.id)
    pageItems.value = pageItems.value.filter((x) => x.id !== r.id)
    totalItems.value -= 1
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- ≥lg: всё в один ряд. -->
    <div class="hidden flex-wrap items-center gap-2 lg:flex">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по номеру" />
      <select v-model="supplierFilter" class="input max-w-[200px]">
        <option value="">Все поставщики</option>
        <option v-for="s in supplierList" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
      </select>
      <DateRangeFilter
        :month-label="monthLabel"
        :month-label-short="monthLabelShort"
        :specific-date="specificDate"
        @today="applyMonth(0)"
        @prev="shiftMonth(-1)"
        @next="shiftMonth(1)"
        @pick="applySpecificDate"
      />
      <RouterLink to="/receipts/new" class="btn-primary btn-sm ml-auto">Новый приход</RouterLink>
    </div>

    <!-- <lg: поиск/поставщик, период и кнопка — раздельными рядами. -->
    <div class="space-y-2 lg:hidden">
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="search" class="input w-full sm:max-w-xs sm:flex-1" placeholder="Поиск по номеру" />
        <select v-model="supplierFilter" class="input w-full sm:max-w-[200px]">
          <option value="">Все поставщики</option>
          <option v-for="s in supplierList" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
        </select>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          :month-label="monthLabel"
          :month-label-short="monthLabelShort"
          :specific-date="specificDate"
          @today="applyMonth(0)"
          @prev="shiftMonth(-1)"
          @next="shiftMonth(1)"
          @pick="applySpecificDate"
        />
      </div>

      <div class="flex justify-end">
        <RouterLink to="/receipts/new" class="btn-primary btn-sm">Новый приход</RouterLink>
      </div>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !pageItems.length" />
      <div v-if="pageItems.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div class="cursor-pointer p-4" v-for="r in pageItems" :key="r.id" @click="openReceipt(r)">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ r.number }}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {{ date(r.docDate) }} · {{ supplierName(r) }} · {{ userName(r.receivedBy) }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="badge" :class="STATUS[r.status].cls">{{ STATUS[r.status].label }}</span>
              <button
                v-if="r.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removeDraft(r)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="tabnum text-slate-700 dark:text-slate-300">{{ dualMoney(r.totalUsd, r.totalUzs) }}</span>
            <span
              v-if="r.status === 'posted'"
              class="tabnum"
              :class="hasOutstanding(r) ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'"
            >
              {{ outstandingLabel(r) }}
            </span>
          </div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Номер</th>
            <th class="th">Дата</th>
            <th class="th">Поставщик</th>
            <th class="th">Сотрудник</th>
            <th class="th">Сумма</th>
            <th class="th">К оплате</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in pageItems" :key="r.id" class="table-row cursor-pointer" @click="openReceipt(r)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ r.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(r.docDate) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ supplierName(r) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ userName(r.receivedBy) }}</td>
            <td class="td tabnum">{{ dualMoney(r.totalUsd, r.totalUzs) }}</td>
            <td
              class="td tabnum"
              :class="hasOutstanding(r) ? 'text-amber-600 dark:text-amber-400' : r.status === 'posted' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'"
            >
              <template v-if="r.status === 'posted'">{{ outstandingLabel(r) }}</template>
              <template v-else>—</template>
            </td>
            <td class="td"><span class="badge" :class="STATUS[r.status].cls">{{ STATUS[r.status].label }}</span></td>
            <td class="td text-right">
              <button
                v-if="r.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removeDraft(r)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading" icon="receipt" title="Приходов пока нет" />

      <Pagination
        :page="page"
        :total-pages="totalPages"
        :total-items="totalItems"
        :page-size="pageSize"
        @update:page="page = $event"
      />
    </div>

    <ModalDialog v-if="opened" :title="opened.number" :subtitle="date(opened.docDate) + ' · ' + supplierName(opened)" width="max-w-2xl" @close="opened = null">
      <div
        v-if="opened.status === 'posted'"
        class="mb-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"
      >
        <span class="text-slate-500 dark:text-slate-400">К оплате</span>
        <span class="tabnum font-semibold" :class="hasOutstanding(opened) ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
          {{ outstandingLabel(opened) }}
        </span>
      </div>
      <div class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="i in opened.items ?? []" :key="i.id" class="py-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 font-medium text-slate-800 dark:text-slate-100">{{ i.product?.name ?? '—' }}</div>
            <div class="tabnum shrink-0 font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</div>
          </div>
          <div class="tabnum mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ qty(i.quantity) }} × {{ rawPrice(i.price, i.currency) }} {{ i.currency }} · курс {{ rateFmt(i.rate) }}</div>
        </div>
      </div>

      <table class="hidden w-full text-sm sm:table">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="py-1.5 pr-3">Товар</th>
            <th class="px-3 py-1.5 text-right">Кол-во</th>
            <th class="px-3 py-1.5 text-right">Цена</th>
            <th class="px-3 py-1.5 text-right">Курс</th>
            <th class="py-1.5 pl-3 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in opened.items ?? []" :key="i.id" class="border-t border-slate-200 dark:border-slate-800">
            <td class="py-1.5 pr-3">{{ i.product?.name ?? '—' }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ qty(i.quantity) }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ rawPrice(i.price, i.currency) }} {{ i.currency }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ rateFmt(i.rate) }}</td>
            <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap">{{ money(i.total, i.currency) }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
        <RouterLink
          v-if="opened.status === 'posted' && hasOutstanding(opened) && auth.can('supplierPayments.create') && supplierId(opened)"
          :to="`/suppliers/${supplierId(opened)}/payment/new?receipt=${opened.id}`"
          class="btn-primary"
        >
          Оплатить
        </RouterLink>
        <button
          v-if="opened.status === 'posted' && auth.can('receipts.create') && !isPaidToward(opened)"
          class="btn-danger"
          :disabled="cancelling"
          @click="cancelReceipt(opened)"
        >
          Отменить приход
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
