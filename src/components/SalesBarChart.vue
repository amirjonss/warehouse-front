<script setup>
import { computed, ref } from 'vue'
import { dateShort, money, moneyShort } from '@/utils/format'

/** Одна серия — выручка по дням. Легенда не нужна, заголовок называет серию. */
const props = defineProps({
  data: { type: Array, required: true }, // [{ date, total, count }]
  height: { type: Number, default: 200 },
  tone: { type: String, default: 'indigo' }, // indigo | red
  countLabel: { type: String, default: 'продаж' },
})

const TONES = {
  indigo: { bar: 'bg-indigo-600', barHover: 'bg-indigo-700' },
  red: { bar: 'bg-red-500', barHover: 'bg-red-600' },
}
const toneClasses = computed(() => TONES[props.tone] ?? TONES.indigo)

const hovered = ref(null)

const max = computed(() => Math.max(1, ...props.data.map((d) => d.total)))
const peakIndex = computed(() => props.data.findIndex((d) => d.total === max.value))

/** Три опорные линии — сетка должна оставаться фоном, а не рисунком. */
const ticks = computed(() => [max.value, max.value / 2, 0])

const barHeight = (v) => `${Math.max(v > 0 ? 2 : 0, (v / max.value) * 100)}%`

/** Подписи по оси X прореживаем, чтобы они не наезжали друг на друга. */
const labelEvery = computed(() => (props.data.length > 20 ? 5 : props.data.length > 10 ? 3 : 1))
</script>

<template>
  <div class="relative">
    <div class="flex gap-3">
      <!-- Ось значений -->
      <div
        class="tabnum flex w-12 shrink-0 flex-col justify-between py-0 text-right text-[10px] text-slate-400 dark:text-slate-500"
        :style="{ height: `${height}px` }"
      >
        <span v-for="(t, i) in ticks" :key="i">{{ t === 0 ? '0' : moneyShort(t) }}</span>
      </div>

      <div class="relative min-w-0 flex-1">
        <!-- Сетка -->
        <div class="absolute inset-0 flex flex-col justify-between" :style="{ height: `${height}px` }">
          <div v-for="i in 3" :key="i" class="border-t border-slate-100 dark:border-slate-800" />
        </div>

        <!-- Столбцы -->
        <div class="relative flex items-end gap-[2px]" :style="{ height: `${height}px` }">
          <div
            v-for="(d, i) in data"
            :key="d.date"
            class="group relative flex h-full flex-1 cursor-default items-end"
            @mouseenter="hovered = i"
            @mouseleave="hovered = null"
          >
            <div
              class="w-full rounded-t-[4px] transition-colors"
              :class="hovered === i ? toneClasses.barHover : toneClasses.bar"
              :style="{ height: barHeight(d.total) }"
            />
            <!--
              Подпись только у пика: цифра на каждом столбце превращается в шум.
              Пик всегда во всю высоту, поэтому подпись ставим внутрь столбца.
            -->
            <div
              v-if="i === peakIndex && hovered === null"
              class="tabnum pointer-events-none absolute top-1 right-0 left-0 hidden text-center text-[10px] font-semibold text-white sm:block"
            >
              {{ moneyShort(d.total) }}
            </div>
          </div>
        </div>

        <!-- Ось дат -->
        <div class="mt-2 flex gap-[2px]">
          <div
            v-for="(d, i) in data"
            :key="d.date"
            class="min-w-0 flex-1 text-center text-[9px] whitespace-nowrap text-slate-400 sm:text-[10px] dark:text-slate-500"
          >
            {{ i % labelEvery === 0 ? dateShort(d.date) : '' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Подсказка -->
    <div
      v-if="hovered !== null"
      class="pointer-events-none absolute top-0 z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40"
      :style="{
        left: `calc(48px + ${((hovered + 0.5) / data.length) * 100}%)`,
        transform: 'translateX(-50%)',
      }"
    >
      <div class="font-medium text-slate-800 dark:text-slate-100">{{ dateShort(data[hovered].date) }}</div>
      <div class="tabnum mt-0.5 text-slate-600 dark:text-slate-300">{{ money(data[hovered].total) }}</div>
      <div class="text-slate-400 dark:text-slate-500">{{ data[hovered].count }} {{ countLabel }}</div>
    </div>
  </div>
</template>
