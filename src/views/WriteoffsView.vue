<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Pagination from '@/components/Pagination.vue'
import { date } from '@/utils/format'
import { dayAfter, dayBefore, useDateRangeFilter } from '@/composables/useDateRangeFilter'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { api } from '@/api/client'
import { changeWriteoffStatus, writeoffs } from '@/api/resources'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirmStore = useConfirmStore()

const { from, to, specificDate, monthLabel, monthLabelShort, applyMonth, shiftMonth, applySpecificDate } = useDateRangeFilter()

const loading = ref(true)
const error = ref('')
const opened = ref(null)
const cancelling = ref(false)

const STATUS = {
  draft: { label: 'черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  posted: { label: 'проведено', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: 'отменено', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
}

const page = ref(1)
const pageSize = 20
const pageItems = ref([])
const totalItems = ref(0)

/** Writeoff уже отдаёт items с вложенными product.name и batch.number (writeoffs:read) — отдельных запросов не нужно. */
async function loadPage(p) {
  loading.value = true
  error.value = ''
  try {
    const params = { page: p, itemsPerPage: pageSize, 'order[docDate]': 'desc' }
    if (from.value) params['docDate[strictly_after]'] = dayBefore(from.value)
    if (to.value) params['docDate[strictly_before]'] = dayAfter(to.value)
    const { items: fetched, totalItems: total } = await api.getPage('/writeoffs', params)
    pageItems.value = fetched
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
      opened.value = await writeoffs.get(route.query.doc)
    } catch {
      /* документ не нашёлся — просто не открываем модалку */
    }
  }
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)))

const productName = (v) => v?.name ?? '—'
const batchNumber = (v) => v?.number ?? '—'

/** Черновик открывается на редактирование, проведённое/отменённое — в режиме просмотра. */
function open(w) {
  if (w.status === 'draft') router.push(`/writeoffs/${w.id}/edit`)
  else opened.value = w
}

/** Удалить можно только черновик — проведённое списание уже списало товар со склада. */
async function removeDraft(w) {
  if (!(await confirmStore.ask(`Удалить черновик «${w.number}»?`))) return
  try {
    await writeoffs.remove(w.id)
    pageItems.value = pageItems.value.filter((x) => x.id !== w.id)
    totalItems.value -= 1
  } catch (e) {
    error.value = e.message
  }
}

/** Проведённое списание не удаляется — отмена возвращает товар на склад корректирующим движением. */
async function cancelWriteoff(w) {
  if (!(await confirmStore.ask(`Отменить списание «${w.number}»? Товар вернётся на склад.`))) return
  cancelling.value = true
  try {
    await changeWriteoffStatus(w.id, 'cancelled')
    opened.value = null
    await loadPage(page.value)
  } catch (e) {
    error.value = e.message
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
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
      <span class="text-sm text-slate-500 dark:text-slate-400">Всего списаний: {{ totalItems }}</span>
      <RouterLink to="/writeoffs/new" class="btn-primary btn-sm ml-auto">Новое списание</RouterLink>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div class="card overflow-hidden">
      <div v-if="pageItems.length" class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div
          v-for="w in pageItems"
          :key="w.id"
          class="cursor-pointer p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
          @click="open(w)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-slate-800 dark:text-slate-100">{{ w.number }}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{{ date(w.docDate) }} · {{ w.reason }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="badge" :class="STATUS[w.status].cls">{{ STATUS[w.status].label }}</span>
              <button
                v-if="w.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removeDraft(w)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Позиций: {{ w.items?.length ?? 0 }}
          </div>
        </div>
      </div>

      <table v-if="pageItems.length" class="hidden w-full sm:table">
        <thead>
          <tr>
            <th class="th">Номер</th>
            <th class="th">Дата</th>
            <th class="th">Причина</th>
            <th class="th">Позиций</th>
            <th class="th">Статус</th>
            <th class="th"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in pageItems" :key="w.id" class="table-row cursor-pointer" @click="open(w)">
            <td class="td font-medium text-slate-800 dark:text-slate-100">{{ w.number }}</td>
            <td class="td text-slate-500 dark:text-slate-400">{{ date(w.docDate) }}</td>
            <td class="td text-slate-600 dark:text-slate-400">{{ w.reason }}</td>
            <td class="td tabnum">{{ w.items?.length ?? 0 }}</td>
            <td class="td"><span class="badge" :class="STATUS[w.status].cls">{{ STATUS[w.status].label }}</span></td>
            <td class="td text-right">
              <button
                v-if="w.status === 'draft'"
                class="btn-ghost btn-sm"
                title="Удалить черновик"
                @click.stop="removeDraft(w)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="!loading && totalItems === 0" icon="trash" title="Списаний пока нет" />
      <EmptyState v-else-if="!loading" icon="trash" title="Ничего не найдено на этой странице" text="Попробуйте другую страницу или период" />

      <Pagination :page="page" :total-pages="totalPages" :total-items="totalItems" :page-size="pageSize" @update:page="page = $event" />
    </div>

    <ModalDialog v-if="opened" :title="opened.number" :subtitle="date(opened.docDate) + ' · ' + opened.reason" @close="opened = null">
      <div class="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
        <div v-for="i in opened.items ?? []" :key="i.id" class="py-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 font-medium text-slate-800 dark:text-slate-100">{{ productName(i.product) }}</div>
            <div class="tabnum shrink-0 text-slate-700 dark:text-slate-300">{{ i.quantity }}</div>
          </div>
          <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ batchNumber(i.batch) }}</div>
        </div>
      </div>

      <table class="hidden w-full text-sm sm:table">
        <thead>
          <tr class="text-left text-xs text-slate-500 dark:text-slate-400">
            <th class="py-1.5 pr-3">Товар</th>
            <th class="px-3 py-1.5">Партия</th>
            <th class="py-1.5 pl-3 text-right">Кол-во</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in opened.items ?? []" :key="i.id" class="border-t border-slate-100 dark:border-slate-800">
            <td class="py-1.5 pr-3">{{ productName(i.product) }}</td>
            <td class="px-3 py-1.5">{{ batchNumber(i.batch) }}</td>
            <td class="tabnum py-1.5 pl-3 text-right whitespace-nowrap">{{ i.quantity }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="btn-ghost" @click="opened = null">Закрыть</button>
        <button
          v-if="opened.status === 'posted' && auth.can('writeoffs.create')"
          class="btn-danger"
          :disabled="cancelling"
          @click="cancelWriteoff(opened)"
        >
          Отменить списание
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
