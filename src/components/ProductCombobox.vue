<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { qty, unitLabel } from '@/utils/format'
import { useDebouncedValue } from '@/composables/useDebouncedValue'
import { api } from '@/api/client'

/**
 * Комбобокс с поиском товара по бэкенду (?name=...) — раньше тянул сюда весь
 * каталог сразу, теперь ищет по мере ввода, как на странице «Товары».
 */
const props = defineProps({
  modelValue: { type: String, default: '' },
  excludeIds: { type: Array, default: () => [] }, // id уже добавленных в документ товаров — скрываем из подсказок
  placeholder: { type: String, default: 'Начните вводить название' },
})
const emit = defineEmits(['update:modelValue', 'select'])

const query = ref('')
const open = ref(false)
const activeIndex = ref(0)
const results = ref([])
const loading = ref(false)

const debouncedQuery = useDebouncedValue(query, 300)
const searchQuery = computed(() => {
  const q = debouncedQuery.value.trim()
  return q.length >= 2 ? q : ''
})

watch(searchQuery, async (q) => {
  if (!q) {
    results.value = []
    return
  }
  loading.value = true
  try {
    const { items } = await api.getPage('/products', { page: 1, itemsPerPage: 20, name: q })
    results.value = items
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
})

/** Сброс извне (родитель очищает line.productId после добавления позиции). */
watch(
  () => props.modelValue,
  (v) => {
    if (!v) query.value = ''
  },
)

const filtered = computed(() => {
  const exclude = new Set((props.excludeIds ?? []).map(String))
  return results.value.filter((p) => !exclude.has(String(p.id)))
})

function openList() {
  open.value = true
  activeIndex.value = 0
}

function onInput() {
  open.value = true
  activeIndex.value = 0
  if (query.value === '') emit('update:modelValue', '')
}

function pick(p) {
  query.value = p.name
  open.value = false
  emit('update:modelValue', String(p.id))
  emit('select', p)
}

function onKeydown(e) {
  if (!open.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    openList()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const p = filtered.value[activeIndex.value]
    if (p) pick(p)
  } else if (e.key === 'Escape') {
    open.value = false
  }
}

function onBlur() {
  open.value = false
  if (!props.modelValue) query.value = ''
}
</script>

<template>
  <div class="relative">
    <input
      v-model="query"
      type="text"
      class="input pr-8"
      :placeholder="placeholder"
      autocomplete="off"
      @focus="openList"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <AppIcon
      name="search"
      :size="15"
      class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 dark:text-slate-500"
    />

    <ul
      v-if="open && filtered.length"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      <li
        v-for="(p, idx) in filtered"
        :key="p.id"
        class="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm"
        :class="idx === activeIndex ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'"
        @mousedown.prevent="pick(p)"
        @mouseenter="activeIndex = idx"
      >
        <div class="min-w-0">
          <div class="truncate font-medium">{{ p.name }}</div>
          <div v-if="p.sku" class="text-xs text-slate-400 dark:text-slate-500">{{ p.sku }}</div>
        </div>
        <span
          v-if="p.remainingQty !== undefined"
          class="tabnum shrink-0 text-xs"
          :class="Number(p.remainingQty) > 0 ? 'text-slate-400 dark:text-slate-500' : 'text-red-500 dark:text-red-400'"
        >
          {{ Number(p.remainingQty) > 0 ? `${qty(p.remainingQty)} ${unitLabel(p.unit)}` : 'нет' }}
        </span>
      </li>
    </ul>
    <div
      v-else-if="open && loading"
      class="absolute z-20 mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
    >
      Поиск…
    </div>
    <div
      v-else-if="open && searchQuery && !filtered.length"
      class="absolute z-20 mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
    >
      Ничего не найдено
    </div>
    <div
      v-else-if="open && query.trim() && !searchQuery"
      class="absolute z-20 mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
    >
      Введите минимум 2 символа
    </div>
  </div>
</template>
