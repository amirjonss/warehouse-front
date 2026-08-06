<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/components/AppShell.vue'

const route = useRoute()
const blank = computed(() => route.meta.layout === 'blank')
</script>

<template>
  <RouterView v-if="blank" v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>
  <AppShell v-else>
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
  </AppShell>
</template>
