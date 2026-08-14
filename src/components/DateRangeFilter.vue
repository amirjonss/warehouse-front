<script setup>
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  monthLabel: { type: String, required: true },
  monthLabelShort: { type: String, required: true },
  specificDate: { type: String, default: '' },
})
const emit = defineEmits(['today', 'prev', 'next', 'pick'])
</script>

<template>
  <button
    type="button"
    class="hidden shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 sm:block dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    @click="emit('today')"
  >
    Сегодня
  </button>
  <div class="inline-flex shrink-0 items-center gap-1">
    <button
      type="button"
      class="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      title="Предыдущий месяц"
      @click="emit('prev')"
    >
      <AppIcon name="chevronLeft" :size="18" />
    </button>
    <span class="min-w-[90px] text-center text-sm font-medium text-slate-700 sm:min-w-[110px] dark:text-slate-200">
      <span class="sm:hidden">{{ monthLabelShort }}</span>
      <span class="hidden sm:inline">{{ monthLabel }}</span>
    </span>
    <button
      type="button"
      class="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      title="Следующий месяц"
      @click="emit('next')"
    >
      <AppIcon name="chevronRight" :size="18" />
    </button>
  </div>
  <input
    :value="specificDate"
    type="date"
    title="Конкретная дата"
    class="input max-w-[140px] shrink-0"
    @change="emit('pick', $event.target.value)"
  />
</template>
