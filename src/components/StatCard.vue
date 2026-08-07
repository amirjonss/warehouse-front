<script setup>
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  label: String,
  value: [String, Number],
  hint: String,
  icon: { type: String, default: 'money' },
  tone: { type: String, default: 'blue' }, // blue | green | amber | red | slate
  to: String,
})

const TONES = {
  blue: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
  green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  red: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'div'"
    :to="to"
    class="card-pad flex flex-col gap-2 transition sm:flex-row sm:items-start sm:gap-3"
    :class="to ? 'hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500/40' : ''"
  >
    <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg sm:h-10 sm:w-10" :class="TONES[tone]">
      <AppIcon :name="icon" :size="20" />
    </div>
    <div class="min-w-0">
      <div class="text-xs font-medium text-slate-500 dark:text-slate-400">{{ label }}</div>
      <div class="tabnum mt-0.5 truncate text-xl font-semibold text-slate-800 sm:text-2xl dark:text-slate-100">
        {{ value }}
      </div>
      <div v-if="hint" class="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{{ hint }}</div>
    </div>
  </component>
</template>
