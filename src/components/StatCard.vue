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
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-600',
}
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'div'"
    :to="to"
    class="card-pad flex flex-col gap-2 transition sm:flex-row sm:items-start sm:gap-3"
    :class="to ? 'hover:border-blue-300 hover:shadow-md' : ''"
  >
    <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg sm:h-10 sm:w-10" :class="TONES[tone]">
      <AppIcon :name="icon" :size="20" />
    </div>
    <div class="min-w-0">
      <div class="text-xs font-medium text-slate-500">{{ label }}</div>
      <div class="tabnum mt-0.5 truncate text-xl font-semibold text-slate-800 sm:text-2xl">
        {{ value }}
      </div>
      <div v-if="hint" class="mt-0.5 truncate text-xs text-slate-400">{{ hint }}</div>
    </div>
  </component>
</template>
