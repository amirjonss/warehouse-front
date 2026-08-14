<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  title: String,
  subtitle: String,
  width: { type: String, default: 'max-w-lg' },
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
    <div class="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/70" @click="emit('close')" />
    <div
      class="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900 dark:shadow-black/40"
      :class="props.width"
    >
      <div class="flex items-start gap-3 border-b border-slate-300 px-5 py-4 dark:border-slate-800">
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-slate-800 dark:text-slate-100">{{ title }}</h3>
          <p v-if="subtitle" class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ subtitle }}</p>
        </div>
        <button
          class="-mt-1 ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          @click="emit('close')"
          aria-label="Закрыть"
        >
          <AppIcon name="close" :size="20" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4">
        <slot />
      </div>

      <div v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-slate-300 px-5 py-3.5 dark:border-slate-800">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
