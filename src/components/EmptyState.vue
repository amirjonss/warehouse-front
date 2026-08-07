<script setup>
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  icon: { type: String, default: 'search' },
  title: { type: String, default: 'Ничего не найдено' },
  text: String,
})
</script>

<template>
  <div class="flex flex-col items-center justify-center px-4 py-14 text-center">
    <div class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
      <AppIcon :name="icon" :size="24" />
    </div>
    <div class="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">{{ title }}</div>
    <p v-if="text" class="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-500">{{ text }}</p>
    <div class="mt-4"><slot /></div>
  </div>
</template>
