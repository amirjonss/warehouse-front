<script setup>
/**
 * История подотчётов: закрытые смены продавцов по периодам.
 *
 * Открытые смены живут на «Кассах продавцов» — здесь только то, что уже
 * закрыто и пересчитано, поэтому главный столбец не остаток, а недостача:
 * ради неё модуль и делался. Недостачи тянем одним запросом по журналу за тот
 * же период — строка SHORTAGE создаётся ровно в момент закрытия смены.
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import Spinner from '@/components/Spinner.vue'
import StatCard from '@/components/StatCard.vue'
import { dateTime, dualLabel, money, pluralRu, userName } from '@/utils/format'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import { cashSessionSummary, users } from '@/api/resources'

const auth = useAuthStore()

/** Продавец видит ту же историю, но строго по себе: фильтр по нему прибит, а не выбирается. */
const isAdmin = computed(() => auth.can('cash.admin'))
const myIri = computed(() => `/api/users/${auth.user?.id}`)

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')

const sellers = ref([])
const seller = ref(auth.can('cash.admin') ? '' : `/api/users/${auth.user?.id}`) // IRI продавца или '' — все

const page = ref(1)
const pageSize = 20 // столько же отдаёт бэкенд (paginationItemsPerPage у CashSession)
const pageItems = ref([])
const totalItems = ref(0)

/** Недостачи по id смены: { [id]: { usd, uzs } } плюс общий итог за период. */
const shortages = ref({})
const shortageTotal = ref({ usd: 0, uzs: 0 })

const shortageLabel = computed(() => dualLabel(shortageTotal.value.usd, shortageTotal.value.uzs))
const closedHint = computed(
  () => `${totalItems.value} ${pluralRu(totalItems.value, ['закрытая смена', 'закрытые смены', 'закрытых смен'])} за период`,
)

const sessionId = (iri) => Number(String(iri).split('/').pop())

/** Границы периода в том же виде, в каком их ждут date-фильтры API. */
function rangeParams(field) {
  const params = {}
  if (from.value) params[`${field}[strictly_after]`] = dayBefore(from.value)
  if (to.value) params[`${field}[strictly_before]`] = dayAfter(to.value)
  return params
}

async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = {
      page: p,
      itemsPerPage: pageSize,
      status: 'closed',
      'order[closedAt]': 'desc',
      ...rangeParams('closedAt'),
    }
    if (seller.value) params.user = seller.value
    const { items, totalItems: total } = await api.getPage('/cash_sessions', params)
    pageItems.value = items
    totalItems.value = total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadShortages() {
  try {
    const params = { kind: 'shortage', 'order[occurredAt]': 'desc', ...rangeParams('occurredAt') }
    if (seller.value) params['session.user'] = seller.value
    const rows = await api.getCollection('/cash_entries', params)

    const grouped = {}
    const total = { usd: 0, uzs: 0 }
    for (const row of rows) {
      const id = typeof row.session === 'string' ? sessionId(row.session) : row.session?.id
      const sum = Math.abs(Number(row.amount))
      const key = row.currency === 'USD' ? 'usd' : 'uzs'
      ;(grouped[id] ??= { usd: 0, uzs: 0 })[key] += sum
      total[key] += sum
    }
    shortages.value = grouped
    shortageTotal.value = total
  } catch (e) {
    error.value = e.message
  }
}

async function loadSellers() {
  if (!isAdmin.value) return // список сотрудников продавцу не нужен и не доступен
  try {
    sellers.value = await users.list()
  } catch {
    /* фильтр по продавцу — не повод ронять страницу */
  }
}

function reload() {
  page.value = 1
  loadPage(1)
  loadShortages()
}

onMounted(() => {
  loadSellers()
  loadPage(1)
  loadShortages()
})
watch(page, (p) => loadPage(p))
watch([from, to, seller], reload)

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

const shortageOf = (s) => shortages.value[s.id] ?? null
const shortageText = (s) => {
  const sh = shortageOf(s)
  if (!sh) return ''
  const label = dualLabel(sh.usd, sh.uzs)
  return [label.primary, label.secondary].filter(Boolean).join(' · ')
}

/* --- Карточка смены: оборот и журнал уже закрытого подотчёта --- */

const detail = ref(null) // выбранная смена
const detailLoading = ref(false)
const detailError = ref('')
const detailSummary = ref({ turnover: [] })
const detailEntries = ref([])

const METHOD_LABELS = { cash: 'Наличными', card: 'Картой', transfer: 'Перечислением' }
const KIND = {
  collect: { label: 'Принято от клиента', icon: 'wallet', tone: 'text-green-600 dark:text-green-400' },
  expense: { label: 'Расход', icon: 'trendDown', tone: 'text-red-600 dark:text-red-400' },
  handover: { label: 'Сдано владельцу', icon: 'money', tone: 'text-indigo-600 dark:text-indigo-400' },
  shortage: { label: 'Недостача', icon: 'alert', tone: 'text-amber-600 dark:text-amber-400' },
}

const turnoverRows = computed(() =>
  [...(detailSummary.value.turnover ?? [])].sort((a, b) => (a.method === 'cash' ? -1 : b.method === 'cash' ? 1 : 0)),
)

/** Сколько всего сдано владельцу за смену — считаем по журналу, а не по остатку. */
const handedLabel = computed(() => {
  const acc = { USD: 0, UZS: 0 }
  for (const e of detailEntries.value) {
    if (e.kind === 'handover') acc[e.currency] += Math.abs(Number(e.amount))
  }
  return dualLabel(acc.USD, acc.UZS)
})

function signed(entry) {
  const n = Number(entry.amount)
  const body = money(Math.abs(n), entry.currency)
  return n < 0 ? `− ${body}` : `+ ${body}`
}

async function openDetail(session) {
  detail.value = session
  detailLoading.value = true
  detailError.value = ''
  detailSummary.value = { turnover: [] }
  detailEntries.value = []
  try {
    const [sum, journal] = await Promise.all([
      cashSessionSummary(session.id),
      api.getCollection('/cash_entries', {
        session: `/api/cash_sessions/${session.id}`,
        'order[occurredAt]': 'desc',
        'order[id]': 'desc',
      }),
    ])
    detailSummary.value = sum
    detailEntries.value = journal
  } catch (e) {
    detailError.value = e.message
  } finally {
    detailLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Две плитки в один ряд и на телефоне: цифры короткие, места хватает. -->
    <div class="grid grid-cols-2 gap-2 sm:gap-3">
      <StatCard
        label="Закрыто смен"
        :value="totalItems"
        :hint="closedHint"
        icon="check"
        tone="slate"
      />
      <StatCard
        label="Недостачи за период"
        :value="shortageLabel.primary"
        :sub-value="shortageLabel.secondary"
        :hint="isAdmin ? 'Не донесли при закрытии смены' : 'Не хватило при закрытии смены'"
        icon="alert"
        :tone="shortageTotal.usd || shortageTotal.uzs ? 'red' : 'slate'"
      />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <select v-if="isAdmin" v-model="seller" class="input w-full sm:max-w-xs">
        <option value="">Все продавцы</option>
        <option v-for="u in sellers" :key="u.id" :value="`/api/users/${u.id}`">{{ userName(u) }}</option>
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
      <!-- На телефоне ссылка уезжает на свою строку: рядом с фильтром периода ей тесно. -->
      <RouterLink v-if="isAdmin" to="/cash-sessions" class="btn-ghost btn-sm w-full justify-center sm:ml-auto sm:w-auto">
        <AppIcon name="wallet" :size="16" /> Открытые смены
      </RouterLink>
      <RouterLink v-else to="/cash" class="btn-ghost btn-sm w-full justify-center sm:ml-auto sm:w-auto">
        <AppIcon name="money" :size="16" /> Моя касса
      </RouterLink>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
      {{ error }}
    </p>

    <div class="card overflow-hidden">
      <Spinner v-if="loading && !pageItems.length" />

      <div v-if="pageItems.length" class="divide-y divide-slate-200 sm:hidden dark:divide-slate-800">
        <button
          v-for="s in pageItems"
          :key="s.id"
          class="flex w-full items-start justify-between gap-2 p-4 text-left"
          @click="openDetail(s)"
        >
          <div class="min-w-0">
            <div class="font-medium text-slate-800 dark:text-slate-100">
              {{ isAdmin ? userName(s.user) : s.number }}
            </div>
            <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <template v-if="isAdmin">{{ s.number }} · </template>{{ dateTime(s.openedAt) }} — {{ dateTime(s.closedAt) }}
            </div>
          </div>
          <span
            v-if="shortageOf(s)"
            class="badge shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
          >
            {{ shortageText(s) }}
          </span>
        </button>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Смена</th>
            <th v-if="isAdmin" class="th">Продавец</th>
            <th class="th">Открыта</th>
            <th class="th">Закрыта</th>
            <th class="th">Принял</th>
            <th class="th">Недостача</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in pageItems" :key="s.id" class="table-row cursor-pointer" @click="openDetail(s)">
            <td class="td font-medium text-slate-700 dark:text-slate-200">{{ s.number }}</td>
            <td v-if="isAdmin" class="td text-slate-700 dark:text-slate-300">{{ userName(s.user) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ dateTime(s.openedAt) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ dateTime(s.closedAt) }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ userName(s.closedBy) }}</td>
            <td class="td tabnum">
              <span v-if="shortageOf(s)" class="font-medium text-amber-600 dark:text-amber-400">{{ shortageText(s) }}</span>
              <span v-else class="text-slate-400 dark:text-slate-600">—</span>
            </td>
            <td class="td text-right">
              <span class="btn-ghost btn-sm" title="Открыть смену">
                <AppIcon name="eye" :size="14" />
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <EmptyState v-else-if="!loading" icon="clock" title="Закрытых смен за период нет" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>

    <ModalDialog
      v-if="detail"
      :title="`Смена ${detail.number}`"
      :subtitle="`${userName(detail.user)} · ${dateTime(detail.openedAt)} — ${dateTime(detail.closedAt)}`"
      width="max-w-2xl"
      @close="detail = null"
    >
      <Spinner v-if="detailLoading" />
      <p v-else-if="detailError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
        {{ detailError }}
      </p>
      <div v-else class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <div class="text-xs text-slate-500 dark:text-slate-400">Сдано владельцу</div>
            <div class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ handedLabel.primary }}</div>
            <div v-if="handedLabel.secondary" class="tabnum text-xs text-slate-500 dark:text-slate-400">
              {{ handedLabel.secondary }}
            </div>
          </div>
          <div class="rounded-lg px-3 py-2" :class="shortageOf(detail) ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-slate-50 dark:bg-slate-800/60'">
            <div class="text-xs text-slate-500 dark:text-slate-400">Недостача</div>
            <div class="tabnum font-semibold" :class="shortageOf(detail) ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'">
              {{ shortageText(detail) || 'нет' }}
            </div>
            <div class="text-xs text-slate-400 dark:text-slate-500">закрыл {{ userName(detail.closedBy) }}</div>
          </div>
        </div>

        <div v-if="turnoverRows.length">
          <div class="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Оборот по способам оплаты</div>
          <div class="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            <div v-for="row in turnoverRows" :key="row.method + row.currency" class="flex items-center justify-between px-3 py-2">
              <span class="text-sm text-slate-600 dark:text-slate-300">{{ METHOD_LABELS[row.method] ?? row.method }}</span>
              <span class="tabnum text-sm font-medium text-slate-800 dark:text-slate-100">{{ money(row.total, row.currency) }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Журнал наличных</div>
          <div v-if="detailEntries.length" class="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            <div v-for="e in detailEntries" :key="e.id" class="flex items-center justify-between gap-3 px-3 py-2">
              <div class="flex min-w-0 items-center gap-2">
                <AppIcon :name="KIND[e.kind]?.icon ?? 'list'" :size="16" class="shrink-0 text-slate-400" />
                <div class="min-w-0">
                  <div class="truncate text-sm text-slate-700 dark:text-slate-200">
                    {{ KIND[e.kind]?.label ?? e.kind }}
                    <span v-if="e.note" class="text-slate-500 dark:text-slate-400"> · {{ e.note }}</span>
                  </div>
                  <div class="text-xs text-slate-400 dark:text-slate-500">
                    {{ dateTime(e.occurredAt) }} · {{ userName(e.createdBy) }}
                  </div>
                </div>
              </div>
              <div class="tabnum shrink-0 text-sm font-semibold" :class="KIND[e.kind]?.tone">{{ signed(e) }}</div>
            </div>
          </div>
          <EmptyState v-else icon="list" title="Движений в смене не было" />
        </div>
      </div>

      <template #footer>
        <button class="btn-ghost" @click="detail = null">Закрыть</button>
      </template>
    </ModalDialog>
  </div>
</template>
