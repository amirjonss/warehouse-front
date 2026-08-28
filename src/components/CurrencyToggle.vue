<script setup>
/** Двухпозиционный переключатель валюты вместо выпадающего списка: обе опции видны сразу. */
const model = defineModel({ type: String, required: true })

const OPTIONS = ['UZS', 'USD']
</script>

<template>
  <div class="flex w-full gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
    <button
      v-for="opt in OPTIONS"
      :key="opt"
      type="button"
      class="flex-1 cursor-pointer rounded-md px-2 py-1 text-sm font-medium transition select-none"
      :class="
        model === opt
          ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500 dark:text-white'
          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
      "
      @click="model = opt"
    >
      {{ opt }}
    </button>
  </div>
</template>
