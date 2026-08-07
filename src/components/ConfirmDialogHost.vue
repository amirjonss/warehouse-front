<script setup>
import ModalDialog from '@/components/ModalDialog.vue'
import { useConfirmStore } from '@/stores/confirm'

const confirmStore = useConfirmStore()
</script>

<template>
  <ModalDialog
    v-if="confirmStore.state.isOpen"
    :title="confirmStore.state.title"
    width="max-w-sm"
    @close="confirmStore.cancel"
  >
    <p class="text-sm text-slate-600 dark:text-slate-300">{{ confirmStore.state.message }}</p>

    <template #footer>
      <button class="btn-ghost" @click="confirmStore.cancel">{{ confirmStore.state.cancelLabel }}</button>
      <button
        :class="confirmStore.state.danger ? 'btn-danger' : 'btn-primary'"
        @click="confirmStore.confirm"
      >
        {{ confirmStore.state.confirmLabel }}
      </button>
    </template>
  </ModalDialog>
</template>
