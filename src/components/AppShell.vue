<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import AppLogo from '@/components/AppLogo.vue'
import RateChip from '@/components/RateChip.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { userName } from '@/utils/format'
import { canPrint } from '@/utils/printer'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const theme = useThemeStore()

// Печать (и её настройки) доступны только в приложении: десктоп или Android.
// В обычном браузере скрываем — там принтер настроить всё равно нельзя.
const showPrinter = canPrint()

const drawerOpen = ref(false)
watch(() => route.fullPath, () => (drawerOpen.value = false))

// Сворачивание сайдбара в узкую полосу с иконками (только десктоп/lg+); выбор запоминаем.
const SIDEBAR_KEY = 'wh_sidebar_collapsed'
const collapsed = ref(localStorage.getItem(SIDEBAR_KEY) === '1')
watch(collapsed, (v) => localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0'))

const profileMenuOpen = ref(false)
watch(() => route.fullPath, () => (profileMenuOpen.value = false))

// Разделы меню: пунктов стало слишком много для одного списка. Заголовок
// пустой — группа идёт без подписи (дашборд), в свёрнутом сайдбаре подписи
// заменяет разделительная линия.
const NAV = [
  {
    title: '',
    items: [{ to: '/', icon: 'dashboard', label: 'Дашборд', perm: 'dashboard' }],
  },
  {
    title: 'Склад',
    items: [
      { to: '/stock', icon: 'boxes', label: 'Остатки', perm: 'stock' },
      { to: '/products', icon: 'tag', label: 'Товары', perm: 'products' },
      { to: '/categories', icon: 'tag', label: 'Категории', perm: 'categories' },
      { to: '/receipts', icon: 'receipt', label: 'Приход', perm: 'receipts' },
      { to: '/writeoffs', icon: 'trash', label: 'Списания', perm: 'writeoffs' },
      { to: '/suppliers', icon: 'truck', label: 'Поставщики', perm: 'suppliers' },
      { to: '/movements', icon: 'list', label: 'Журнал движений', perm: 'movements' },
    ],
  },
  {
    title: 'Продажи',
    items: [
      { to: '/sales', icon: 'cart', label: 'Продажи', perm: 'sales' },
      { to: '/clients', icon: 'users', label: 'Клиенты', perm: 'clients' },
      { to: '/debts', icon: 'wallet', label: 'Долги', perm: 'debts' },
    ],
  },
  {
    title: 'Деньги',
    items: [
      { to: '/cash', icon: 'money', label: 'Моя касса', perm: 'cash' },
      { to: '/cash-sessions', icon: 'wallet', label: 'Кассы продавцов', perm: 'cash.admin' },
      { to: '/cash-sessions/history', icon: 'clock', label: 'История смен', perm: 'cash' },
      { to: '/expenses', icon: 'trendDown', label: 'Расходы', perm: 'expenses' },
      { to: '/profits', icon: 'trendUp', label: 'Прибыль', perm: 'profits' },
    ],
  },
  {
    title: 'Справочники',
    items: [
      { to: '/exchange-rates', icon: 'money', label: 'Курсы валют', perm: 'exchangeRates' },
      { to: '/users', icon: 'shield', label: 'Сотрудники', perm: 'users' },
    ],
  },
]

// Раздел, в котором продавцу ничего не доступно, не показываем вовсе.
const nav = computed(() =>
  NAV.map((group) => ({ ...group, items: group.items.filter((i) => auth.can(i.perm)) })).filter((g) => g.items.length),
)

const navPaths = computed(() => nav.value.flatMap((g) => g.items.map((i) => i.to)))

const initials = computed(() => {
  const first = auth.user?.firstName?.[0] ?? ''
  const last = auth.user?.lastName?.[0] ?? ''
  if (first) return `${first}${last}`.toUpperCase()
  return (auth.user?.email ?? '').split(/[@.]/)[0].slice(0, 2).toUpperCase()
})

const pageTitle = computed(() => route.meta.title ?? '')

/**
 * Подсвечиваем ровно один пункт: сравниваем по границе сегмента (иначе /cash
 * горел бы и на /cash-sessions) и из подходящих берём самый длинный — у
 * «Истории смен» есть свой пункт, и родительские «Кассы продавцов» на ней гаснут.
 */
const activePath = computed(() => {
  const matches = navPaths.value.filter((to) =>
    to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(to + '/'),
  )
  return matches.sort((a, b) => b.length - a.length)[0] ?? ''
})

const isActive = (to) => to === activePath.value

/**
 * Сворачивание разделов. Храним закрытые, а не открытые: новый раздел в меню
 * должен появиться раскрытым, а не спрятаться у тех, кто уже пользуется приложением.
 */
const NAV_GROUPS_KEY = 'wh_nav_groups_closed'
const closedGroups = ref(new Set(JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) ?? '[]')))

function persistGroups() {
  localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify([...closedGroups.value]))
}

function toggleGroup(title) {
  if (closedGroups.value.has(title)) closedGroups.value.delete(title)
  else closedGroups.value.add(title)
  persistGroups()
}

const isGroupOpen = (title) => !title || !closedGroups.value.has(title)

const activeGroup = computed(() => nav.value.find((g) => g.items.some((i) => i.to === activePath.value))?.title ?? '')

// Переход по ссылке (в том числе из карточки или с дашборда) раскрывает раздел,
// в котором оказался пользователь — иначе активный пункт остаётся невидимым.
watch(
  activeGroup,
  (title) => {
    if (title && closedGroups.value.delete(title)) persistGroups()
  },
  { immediate: true },
)

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-slate-950">
    <!-- Сайдбар: постоянный на десктопе, выдвижной на телефоне -->
    <aside
      class="group/sidebar fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-slate-300 bg-slate-50 transition-[transform,width] duration-200 lg:translate-x-0 dark:border-slate-800 dark:bg-slate-900"
      :class="[drawerOpen ? 'translate-x-0' : '-translate-x-full', collapsed ? 'lg:w-16' : 'lg:w-[248px]']"
      :data-collapsed="collapsed"
    >
      <div class="flex h-16 items-center gap-2.5 px-4 group-data-[collapsed=true]/sidebar:lg:justify-center group-data-[collapsed=true]/sidebar:lg:px-0">
        <AppLogo :size="36" class="shrink-0" />
        <div class="leading-tight group-data-[collapsed=true]/sidebar:lg:hidden">
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

      <nav class="flex-1 overflow-y-auto px-3 py-2">
        <div v-for="group in nav" :key="group.title" class="space-y-1">
          <template v-if="group.title">
            <button
              type="button"
              class="flex w-full items-center gap-1 px-3 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase transition-colors hover:text-slate-600 group-data-[collapsed=true]/sidebar:lg:hidden dark:text-slate-500 dark:hover:text-slate-300"
              :aria-expanded="isGroupOpen(group.title)"
              @click="toggleGroup(group.title)"
            >
              {{ group.title }}
              <AppIcon
                name="chevronDown"
                :size="12"
                class="ml-auto transition-transform"
                :class="isGroupOpen(group.title) ? '' : '-rotate-90'"
              />
            </button>
            <!--
              В узком сайдбаре подписи не видно, поэтому тот же переключатель —
              это сама разделительная линия с шевроном по центру.
            -->
            <button
              type="button"
              class="mx-2 my-2 hidden w-[calc(100%-1rem)] justify-center border-t border-slate-200 pt-1.5 text-slate-400 transition-colors hover:text-slate-600 group-data-[collapsed=true]/sidebar:lg:flex dark:border-slate-800 dark:text-slate-500 dark:hover:text-slate-300"
              :title="group.title"
              :aria-expanded="isGroupOpen(group.title)"
              @click="toggleGroup(group.title)"
            >
              <AppIcon
                name="chevronDown"
                :size="12"
                class="transition-transform"
                :class="isGroupOpen(group.title) ? '' : '-rotate-90'"
              />
            </button>
          </template>
          <div class="space-y-1" :class="isGroupOpen(group.title) ? '' : 'hidden'">
            <RouterLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="nav-link group-data-[collapsed=true]/sidebar:lg:justify-center"
              :class="{ 'nav-link-active': isActive(item.to) }"
              :title="collapsed ? item.label : undefined"
            >
              <AppIcon :name="item.icon" :size="18" class="shrink-0" />
              <span class="group-data-[collapsed=true]/sidebar:lg:hidden">{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>

      <div class="relative border-t border-slate-300 p-3 dark:border-slate-800">
        <!-- Клик вне меню закрывает его -->
        <div v-if="profileMenuOpen" class="fixed inset-0 z-40" @click="profileMenuOpen = false" />

        <div
          v-if="profileMenuOpen"
          class="absolute right-3 bottom-full left-3 z-50 mb-1 space-y-1 rounded-lg border border-slate-300 bg-white p-1.5 shadow-lg group-data-[collapsed=true]/sidebar:lg:right-auto group-data-[collapsed=true]/sidebar:lg:left-2 group-data-[collapsed=true]/sidebar:lg:w-56 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40"
        >
          <RouterLink to="/profile" class="nav-link !px-2 !py-1.5 !text-xs">
            <AppIcon name="users" :size="15" /> Профиль
          </RouterLink>
          <RouterLink v-if="showPrinter" to="/settings/printer" class="nav-link !px-2 !py-1.5 !text-xs">
            <AppIcon name="print" :size="15" /> Настройки принтера
          </RouterLink>
          <button class="nav-link w-full !px-2 !py-1.5 !text-xs" @click="theme.toggle">
            <AppIcon :name="theme.dark ? 'sun' : 'moon'" :size="15" /> {{ theme.dark ? 'Светлая тема' : 'Тёмная тема' }}
          </button>
          <button class="nav-link w-full !px-2 !py-1.5 !text-xs" @click="logout">
            <AppIcon name="logout" :size="15" /> Выйти
          </button>
        </div>

        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-100 group-data-[collapsed=true]/sidebar:lg:justify-center group-data-[collapsed=true]/sidebar:lg:px-0 dark:hover:bg-slate-800"
          :title="collapsed ? (auth.user ? userName(auth.user) : '') : undefined"
          @click="profileMenuOpen = !profileMenuOpen"
        >
          <div
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
            :class="auth.role === 'ROLE_ADMIN' ? 'bg-indigo-600' : 'bg-emerald-600'"
          >
            {{ initials }}
          </div>
          <div class="min-w-0 flex-1 leading-tight group-data-[collapsed=true]/sidebar:lg:hidden">
            <div class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{{ auth.user ? userName(auth.user) : '' }}</div>
            <div class="text-[11px] text-slate-400 dark:text-slate-500">{{ auth.roleTitle }}</div>
          </div>
          <AppIcon name="chevronLeft" :size="14" class="shrink-0 rotate-90 text-slate-400 group-data-[collapsed=true]/sidebar:lg:hidden dark:text-slate-500" />
        </button>
      </div>
    </aside>

    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
      @click="drawerOpen = false"
    />

    <!-- Контент -->
    <div class="transition-[padding] duration-200" :class="collapsed ? 'lg:pl-16' : 'lg:pl-[248px]'">
      <header
        class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-300 bg-white/80 px-4 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-950/80"
      >
        <button
          class="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          @click="drawerOpen = true"
          aria-label="Меню"
        >
          <AppIcon name="menu" :size="22" />
        </button>
        <button
          class="hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:inline-flex dark:text-slate-300 dark:hover:bg-slate-800"
          @click="collapsed = !collapsed"
          :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
          :title="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
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
            <span class="hidden sm:inline">Продажа</span>
          </RouterLink>
        </div>
      </header>

      <main class="p-4 sm:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
