<script setup>
defineProps({
  size: { type: Number, default: 22 },
  label: { type: String, default: 'Загрузка…' },
})
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
    <svg class="animate-spin" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
      <circle class="text-slate-200 dark:text-slate-700" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
      <path class="text-indigo-500 dark:text-indigo-400" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
    <p v-if="label" class="text-xs text-slate-400 dark:text-slate-500">{{ label }}</p>
  </div>
</template>
