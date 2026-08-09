<script setup>
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  totalItems: { type: Number, required: true },
  pageSize: { type: Number, required: true },
})
const emit = defineEmits(['update:page'])

function go(p) {
  if (p < 1 || p > props.totalPages || p === props.page) return
  emit('update:page', p)
}
</script>

<template>
  <div
    v-if="totalPages > 1"
    class="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-800"
  >
    <span class="tabnum text-xs text-slate-500 dark:text-slate-400">
      {{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, totalItems) }} из {{ totalItems }}
    </span>
    <div class="flex items-center gap-1">
      <button class="btn-ghost btn-sm" :disabled="page <= 1" @click="go(page - 1)" aria-label="Предыдущая страница">
        <AppIcon name="chevronLeft" :size="16" />
      </button>
      <span class="tabnum px-2 text-sm text-slate-600 dark:text-slate-400">{{ page }} / {{ totalPages }}</span>
      <button
        class="btn-ghost btn-sm"
        :disabled="page >= totalPages"
        @click="go(page + 1)"
        aria-label="Следующая страница"
      >
        <AppIcon name="chevronRight" :size="16" />
      </button>
    </div>
  </div>
</template>
