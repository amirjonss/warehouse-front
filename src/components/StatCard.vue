<script setup>
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  label: String,
  value: [String, Number],
  subValue: [String, Number],
  hint: String,
  icon: { type: String, default: 'money' },
  tone: { type: String, default: 'blue' }, // blue | green | amber | red | slate
  to: String,
  // Плотный вариант: четыре плитки в ряд, где обычный кегль ломает суммы пополам.
  compact: Boolean,
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
    class="card-pad flex flex-col gap-2 transition"
    :class="[
      // В плотном варианте иконка уезжает вбок только на широком экране: на среднем
      // она отнимала бы у суммы те самые полсотни пикселей, из-за которых число рвётся.
      compact ? 'xl:flex-row xl:items-start xl:gap-3' : 'sm:flex-row sm:items-start sm:gap-3',
      to ? 'hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500/40' : '',
    ]"
  >
    <div
      class="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      :class="[TONES[tone], compact ? '' : 'sm:h-10 sm:w-10']"
    >
      <AppIcon :name="icon" :size="compact ? 18 : 20" />
    </div>
    <div class="min-w-0">
      <div class="text-xs font-medium text-slate-500 dark:text-slate-400">{{ label }}</div>
      <div
        class="tabnum mt-0.5 break-words font-semibold text-slate-800 dark:text-slate-100"
        :class="compact ? 'text-base xl:text-lg' : 'text-xl sm:text-2xl'"
      >
        {{ value }}
      </div>
      <div
        v-if="subValue"
        class="tabnum break-words font-medium text-slate-500 dark:text-slate-400"
        :class="compact ? 'text-xs' : 'text-sm'"
      >
        {{ subValue }}
      </div>
      <!-- В плотном варианте подсказку переносим, а не обрезаем: обрезок нечитаем. -->
      <div
        v-if="hint"
        class="mt-0.5 text-slate-400 dark:text-slate-500"
        :class="compact ? 'text-[11px] leading-tight' : 'truncate text-xs'"
      >
        {{ hint }}
      </div>
    </div>
  </component>
</template>
