<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import { date, money, rawPrice, userName } from '@/utils/format'
import { useConfirmStore } from '@/stores/confirm'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { api } from '@/api/client'
import { sales } from '@/api/resources'

const route = useRoute()
const router = useRouter()
const confirmStore = useConfirmStore()

const loading = ref(true)
const error = ref('')
const search = ref('')
const opened = ref(null)

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

const page = ref(1)
const pageSize = 20
const pageItems = ref([])
const totalItems = ref(0)

/**
 * strictly_after/strictly_before — исключающие границы, поэтому сдвигаем на день наружу
 * (dayBefore/dayAfter), чтобы сам from/to остался внутри диапазона.
 * У Sale нет SearchFilter — поиск по номеру/клиенту фильтрует только уже загруженную страницу.
 */
async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, 'order[docDate]': 'desc' }
    if (from.value) params['docDate[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['docDate[strictly_before]'] = dayAfter(to.value)
    const { items, totalItems: total } = await api.getPage('/sales', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
watch(page, (p) => loadPage(p))
watch([from, to], () => {
  page.value = 1
  loadPage(1)
})

onMounted(async () => {
  await loadPage(1)

  if (route.query.doc) {
    try {
      opened.value = await sales.get(route.query.doc)
    } catch {
      /* документ не нашёлся — просто не открываем модалку */
    }
  }
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

/** Черновик открывается на редактирование, проведённая/отменённая — в режиме просмотра. */
function open(s) {
  if (s.status === 'draft') router.push(`/sales/${s.id}/edit`)
  else opened.value = s
}

/** Удалить можно только черновик — проведённая продажа уже списала товар и создала долг. */
async function removeDraft(s) {
  if (!(await confirmStore.ask(`Удалить черновик «${s.number}»?`))) return
  try {
    await sales.remove(s.id)
    pageItems.value = pageItems.value.filter((x) => x.id !== s.id)
    totalItems.value -= 1
  } catch (e) {
    error.value = e.message
  }
}

const clientName = (v) => v?.name ?? '—'
const productName = (v) => v?.name ?? '—'

const filtered = computed(() =>
  pageItems.value.filter((s) => `${s.number} ${clientName(s.customer)}`.toLowerCase().includes(search.value.toLowerCase())),
)
</script>

<template>
  <div class="space-y-4">
    <!-- ≥lg: всё в один ряд. -->
    <div class="hidden flex-wrap items-center gap-2 lg:flex">
      <input v-model="search" class="input max-w-xs" placeholder="Поиск по номеру/клиенту" />
      <DateRangeFilter
        :month-label="monthLabel"
        :month-label-short="monthLabelShort"
        :specific-date="specificDate"
        @today="applyMonth(0)"
        @prev="shiftMonth(-1)"
        @next="shiftMonth(1)"
        @pick="applySpecificDate"
      />
      <RouterLink to="/sales/new" class="btn-primary btn-sm ml-auto">Новая продажа</RouterLink>
    </div>

    <!-- <lg: поиск, период и кнопка — раздельными рядами. -->
    <div class="space-y-2 lg:hidden">
      <input v-model="search" class="input w-full" placeholder="Поиск по номеру/клиенту" />
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
        <RouterLink to="/sales/new" class="btn-primary btn-sm">Новая продажа</RouterLink>
      </div>
    </div>

    <p class="text-xs text-slate-400 dark:text-slate-500">
      Поиск по номеру/клиенту ищет только на текущей странице — переключите страницу, если не нашли
    </p>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <!-- Мобильный (< sm): карточки вместо таблицы — без горизонтального скролла -->
      <div v-if="filtered.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
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
                {{ date(s.docDate) }} · {{ clientName(s.customer) }} · {{ userName(s.soldBy) }}
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
          <div class="mt-2 text-sm">
            <span class="tabnum text-slate-700 dark:text-slate-300">
              <template v-if="Number(s.totalUsd) > 0">{{ money(s.totalUsd, 'USD') }}</template>
              <template v-if="Number(s.totalUsd) > 0 && Number(s.totalUzs) > 0"> + </template>
              <template v-if="Number(s.totalUzs) > 0">{{ money(s.totalUzs, 'UZS') }}</template>
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
            <th class="th">Продавец</th>
            <th class="th">Сумма</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id" class="table-row cursor-pointer" @click="open(s)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ s.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(s.docDate) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ clientName(s.customer) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ userName(s.soldBy) }}</td>
            <td class="td tabnum">
              <template v-if="Number(s.totalUsd) > 0">{{ money(s.totalUsd, 'USD') }}</template>
              <template v-if="Number(s.totalUsd) > 0 && Number(s.totalUzs) > 0"> + </template>
              <template v-if="Number(s.totalUzs) > 0">{{ money(s.totalUzs, 'UZS') }}</template>
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
      <EmptyState v-else-if="!loading && totalItems === 0" icon="cart" title="Продаж пока нет" />
      <EmptyState v-else-if="!loading" icon="cart" title="Ничего не найдено на этой странице" text="Попробуйте другую страницу или измените поиск" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>

    <ModalDialog v-if="opened" :title="opened.number" :subtitle="date(opened.docDate) + ' · ' + clientName(opened.customer)" @close="opened = null">
      <div class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <div v-for="i in opened.items ?? []" :key="i.id" class="py-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
            <div class="tabnum shrink-0 font-semibold text-slate-800 dark:text-slate-100">{{ money(i.total, i.currency) }}</div>
          </div>
          <div class="tabnum mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ i.quantity }} × {{ rawPrice(i.price, i.currency) }} {{ i.currency }}</div>
        </div>
      </div>

      <table class="hidden w-full text-sm sm:table">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="py-1.5 pr-3">Товар</th>
            <th class="px-3 py-1.5 text-right">Кол-во</th>
            <th class="px-3 py-1.5 text-right">Цена</th>
            <th class="py-1.5 pl-3 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in opened.items ?? []" :key="i.id" class="border-t border-slate-200 dark:border-slate-800">
            <td class="py-1.5 pr-3">{{ productName(i.product) }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ i.quantity }}</td>
            <td class="tabnum px-3 py-1.5 text-right whitespace-nowrap">{{ rawPrice(i.price, i.currency) }} {{ i.currency }}</td>
            <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap">{{ money(i.total, i.currency) }}</td>
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
