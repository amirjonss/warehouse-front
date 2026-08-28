<script setup>
/**
 * Кассы продавцов глазами владельца: у кого сколько наличных на руках, кто уже
 * отдал деньги без подтверждения, и закрытие смены с фиксацией недостачи.
 *
 * Долг продавца перед компанией = «в сумке» + «ждёт подтверждения»: во втором
 * случае деньги у продавца уже забрали, но компания их ещё не признала.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Spinner from '@/components/Spinner.vue'
import StatCard from '@/components/StatCard.vue'
import { dateTime, dualLabel, money, pluralRu, userName } from '@/utils/format'
import { useToastStore } from '@/stores/toast'
import { api } from '@/api/client'
import { cashOnHands, closeCashSession, confirmHandover } from '@/api/resources'

const toast = useToastStore()

const loading = ref(true)
const busy = ref(false)
const error = ref('')

const sessions = ref([])
const onHands = ref({ balanceUsd: '0', balanceUzs: '0', unconfirmedUsd: '0', unconfirmedUzs: '0', openSessions: 0 })
/** Неподтверждённые сдачи по id смены — грузим одним запросом на все смены. */
const declaredBySession = ref({})

const closeModal = ref(false)
const closing = ref(null)
const formError = ref('')
const closeForm = reactive({ acceptedUsd: '0', acceptedUzs: '0', note: '' })

const openSessionsHint = computed(
  () => `${onHands.value.openSessions} ${pluralRu(onHands.value.openSessions, ['открытая смена', 'открытые смены', 'открытых смен'])}`,
)
const onHandsLabel = computed(() => dualLabel(onHands.value.balanceUsd, onHands.value.balanceUzs))
const unconfirmedLabel = computed(() => dualLabel(onHands.value.unconfirmedUsd, onHands.value.unconfirmedUzs))

const sessionId = (iri) => Number(String(iri).split('/').pop())

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [list, totals, declared] = await Promise.all([
      api.getPage('/cash_sessions', { page: 1, itemsPerPage: 50, status: 'open', 'order[openedAt]': 'asc' }),
      cashOnHands(),
      api.getPage('/cash_entries', { page: 1, itemsPerPage: 100, kind: 'handover', status: 'declared', 'order[id]': 'asc' }),
    ])
    sessions.value = list.items
    onHands.value = totals

    const grouped = {}
    for (const entry of declared.items) {
      const id = typeof entry.session === 'string' ? sessionId(entry.session) : entry.session?.id
      ;(grouped[id] ??= []).push(entry)
    }
    declaredBySession.value = grouped
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const declaredFor = (session) => declaredBySession.value[session.id] ?? []

/** Сколько всего числится за продавцом: в сумке плюс не подтверждённое. */
function oweLabel(session) {
  return dualLabel(
    Number(session.balanceUsd) + Number(session.unconfirmedUsd),
    Number(session.balanceUzs) + Number(session.unconfirmedUzs),
  )
}

async function confirm(entry) {
  busy.value = true
  error.value = ''
  try {
    await confirmHandover(entry.id)
    await load()
    toast.success('Приём денег подтверждён')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

function openClose(session) {
  closing.value = session
  // По умолчанию принимаем ровно то, что числится: недостача должна быть
  // осознанным вводом меньшей суммы, а не случайным значением по умолчанию.
  closeForm.acceptedUsd = session.balanceUsd
  closeForm.acceptedUzs = session.balanceUzs
  closeForm.note = ''
  formError.value = ''
  closeModal.value = true
}

const shortage = computed(() => {
  if (!closing.value) return { usd: 0, uzs: 0 }
  return {
    usd: Number(closing.value.balanceUsd) - Number(closeForm.acceptedUsd || 0),
    uzs: Number(closing.value.balanceUzs) - Number(closeForm.acceptedUzs || 0),
  }
})

const hasShortage = computed(() => shortage.value.usd > 0 || shortage.value.uzs > 0)

async function saveClose() {
  busy.value = true
  formError.value = ''
  try {
    await closeCashSession(closing.value.id, {
      acceptedUsd: String(closeForm.acceptedUsd || '0'),
      acceptedUzs: String(closeForm.acceptedUzs || '0'),
      note: closeForm.note.trim() || null,
    })
    closeModal.value = false
    await load()
    toast.success('Смена закрыта')
  } catch (e) {
    formError.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <RouterLink to="/cash-sessions/history" class="btn-ghost btn-sm">
        <AppIcon name="clock" :size="16" /> История смен
      </RouterLink>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:gap-3">
      <StatCard
        label="На руках у продавцов"
        :value="onHandsLabel.primary"
        :sub-value="onHandsLabel.secondary"
        :hint="openSessionsHint"
        icon="wallet"
        tone="amber"
      />
      <StatCard
        label="Ждёт вашего подтверждения"
        :value="unconfirmedLabel.primary"
        :sub-value="unconfirmedLabel.secondary"
        hint="Продавцы отдали, приём не подтверждён"
        icon="clock"
        tone="slate"
      />
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
      {{ error }}
    </p>

    <Spinner v-if="loading" />

    <EmptyState v-else-if="!sessions.length" icon="money" title="Открытых смен нет" />

    <div v-else class="space-y-3">
      <div v-for="s in sessions" :key="s.id" class="card-pad space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-medium text-slate-800 dark:text-slate-100">{{ userName(s.user) }}</div>
            <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {{ s.number }} · открыта {{ dateTime(s.openedAt) }}
            </div>
          </div>
          <div class="text-right">
            <div class="tabnum font-semibold text-slate-800 dark:text-slate-100">{{ oweLabel(s).primary }}</div>
            <div v-if="oweLabel(s).secondary" class="tabnum text-xs text-slate-500 dark:text-slate-400">
              {{ oweLabel(s).secondary }}
            </div>
            <div class="text-[11px] text-slate-400">числится за продавцом</div>
          </div>
        </div>

        <div v-if="declaredFor(s).length" class="rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10">
          <div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AppIcon name="alert" :size="14" />
            Продавец сообщил, что отдал деньги — подтвердите приём
          </div>
          <div class="space-y-2">
            <div v-for="e in declaredFor(s)" :key="e.id" class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0 text-sm text-slate-700 dark:text-slate-200">
                <span class="tabnum font-semibold">{{ money(Math.abs(Number(e.amount)), e.currency) }}</span>
                <span v-if="e.note" class="text-slate-500 dark:text-slate-400"> · {{ e.note }}</span>
                <div class="text-xs text-slate-400">{{ dateTime(e.occurredAt) }}</div>
              </div>
              <button class="btn-primary btn-sm" :disabled="busy" @click="confirm(e)">
                <AppIcon name="check" :size="14" /> Принял
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div class="text-xs text-slate-500 dark:text-slate-400">
            В сумке: <span class="tabnum">{{ money(s.balanceUzs, 'UZS') }}</span>
            <span v-if="Number(s.balanceUsd)" class="tabnum"> · {{ money(s.balanceUsd, 'USD') }}</span>
          </div>
          <button
            class="btn-ghost btn-sm"
            :disabled="busy || declaredFor(s).length > 0"
            :title="declaredFor(s).length ? 'Сначала подтвердите сдачи' : ''"
            @click="openClose(s)"
          >
            <AppIcon name="check" :size="14" /> Закрыть смену
          </button>
        </div>
      </div>
    </div>

    <ModalDialog v-if="closeModal" title="Закрыть смену" @close="closeModal = false" @submit="saveClose">
      <div class="space-y-3">
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          За продавцом числится
          <span class="tabnum font-medium">{{ money(closing.balanceUzs, 'UZS') }}</span>
          <span v-if="Number(closing.balanceUsd)" class="tabnum font-medium"> и {{ money(closing.balanceUsd, 'USD') }}</span>.
          Укажите, сколько приняли фактически.
        </p>
        <div>
          <label class="label">Принято, сўм</label>
          <input v-model="closeForm.acceptedUzs" type="number" step="0.01" class="input" />
        </div>
        <div>
          <label class="label">Принято, $</label>
          <input v-model="closeForm.acceptedUsd" type="number" step="0.01" class="input" />
        </div>
        <div>
          <label class="label">Комментарий</label>
          <input v-model="closeForm.note" class="input" />
        </div>

        <p
          v-if="hasShortage"
          class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
        >
          Недостача:
          <span v-if="shortage.uzs > 0" class="tabnum font-semibold">{{ money(shortage.uzs, 'UZS') }}</span>
          <span v-if="shortage.uzs > 0 && shortage.usd > 0"> и </span>
          <span v-if="shortage.usd > 0" class="tabnum font-semibold">{{ money(shortage.usd, 'USD') }}</span>
          — останется отдельной строкой в журнале как долг продавца.
        </p>

        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {{ formError }}
        </p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="closeModal = false">Отмена</button>
        <button class="btn-primary" :disabled="busy" @click="saveClose">Закрыть смену</button>
      </template>
    </ModalDialog>
  </div>
</template>
