<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import RateChip from '@/components/RateChip.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const theme = useThemeStore()

const drawerOpen = ref(false)
watch(() => route.fullPath, () => (drawerOpen.value = false))

const NAV = [
  { to: '/', icon: 'dashboard', label: 'Дашборд', perm: 'dashboard' },
  { to: '/stock', icon: 'boxes', label: 'Остатки', perm: 'stock' },
  { to: '/products', icon: 'tag', label: 'Товары', perm: 'products' },
  { to: '/categories', icon: 'tag', label: 'Категории', perm: 'categories' },
  { to: '/receipts', icon: 'receipt', label: 'Приход', perm: 'receipts' },
  { to: '/sales', icon: 'truck', label: 'Отгрузки', perm: 'sales' },
  { to: '/writeoffs', icon: 'trash', label: 'Списания', perm: 'writeoffs' },
  { to: '/clients', icon: 'users', label: 'Клиенты', perm: 'clients' },
  { to: '/suppliers', icon: 'truck', label: 'Поставщики', perm: 'suppliers' },
  { to: '/debts', icon: 'wallet', label: 'Долги', perm: 'debts' },
  { to: '/profits', icon: 'trendUp', label: 'Прибыль', perm: 'profits' },
  { to: '/movements', icon: 'list', label: 'Журнал движений', perm: 'movements' },
  { to: '/exchange-rates', icon: 'money', label: 'Курсы валют', perm: 'exchangeRates' },
  { to: '/users', icon: 'shield', label: 'Сотрудники', perm: 'users' },
]

const nav = computed(() => NAV.filter((i) => auth.can(i.perm)))

const initials = computed(() =>
  (auth.user?.email ?? '')
    .split(/[@.]/)[0]
    .slice(0, 2)
    .toUpperCase(),
)

const pageTitle = computed(() => route.meta.title ?? '')

function isActive(to) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-slate-950">
    <!-- Сайдбар: постоянный на десктопе, выдвижной на телефоне -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-slate-200 bg-slate-50 transition-transform duration-200 lg:translate-x-0 dark:border-slate-800 dark:bg-slate-900"
      :class="drawerOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 items-center gap-2.5 px-4">
        <div class="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white">
          <AppIcon name="boxes" :size="20" />
        </div>
        <div class="leading-tight">
          <div class="font-semibold text-slate-900 dark:text-white">Wirehouse</div>
          <div class="text-[11px] text-slate-400 dark:text-slate-500">складской учёт</div>
        </div>
        <button
          class="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 lg:hidden dark:hover:bg-slate-800 dark:hover:text-slate-200"
          @click="drawerOpen = false"
          aria-label="Закрыть меню"
        >
          <AppIcon name="close" :size="20" />
        </button>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ 'nav-link-active': isActive(item.to) }"
        >
          <AppIcon :name="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="border-t border-slate-200 p-3 dark:border-slate-800">
        <div class="flex items-center gap-3 rounded-lg px-2 py-2">
          <div
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
            :class="auth.role === 'ROLE_ADMIN' ? 'bg-indigo-600' : 'bg-emerald-600'"
          >
            {{ initials }}
          </div>
          <div class="min-w-0 leading-tight">
            <div class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{{ auth.user?.email }}</div>
            <div class="text-[11px] text-slate-400 dark:text-slate-500">{{ auth.roleTitle }}</div>
          </div>
        </div>
        <div class="mt-1 flex gap-1">
          <button
            class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            @click="theme.toggle"
          >
            <AppIcon :name="theme.dark ? 'sun' : 'moon'" :size="15" /> {{ theme.dark ? 'Светлая' : 'Тёмная' }}
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            @click="logout"
          >
            <AppIcon name="logout" :size="15" /> Выйти
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
      @click="drawerOpen = false"
    />

    <!-- Контент -->
    <div class="lg:pl-[248px]">
      <header
        class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-950/80"
      >
        <button
          class="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          @click="drawerOpen = true"
          aria-label="Меню"
        >
          <AppIcon name="menu" :size="22" />
        </button>
        <h1 class="truncate text-base font-semibold text-slate-800 sm:text-lg dark:text-slate-100">{{ pageTitle }}</h1>
        <div class="ml-auto flex items-center gap-2">
          <RateChip />
          <RouterLink
            v-if="auth.can('sales.create')"
            to="/sales/new"
            class="btn-primary btn-sm sm:px-3.5 sm:py-2 sm:text-sm"
          >
            <AppIcon name="plus" :size="16" />
            <span class="hidden sm:inline">Отгрузка</span>
          </RouterLink>
          <RouterLink
            v-if="auth.can('receipts.create')"
            to="/receipts/new"
            class="btn-ghost btn-sm sm:px-3.5 sm:py-2 sm:text-sm"
          >
            <AppIcon name="plus" :size="16" />
            <span class="hidden sm:inline">Приход</span>
          </RouterLink>
        </div>
      </header>

      <main class="p-4 sm:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
