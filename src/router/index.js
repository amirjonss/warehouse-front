import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, layout: 'blank' },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: 'Дашборд', perm: 'dashboard' },
  },
  {
    path: '/stock',
    name: 'stock',
    component: () => import('@/views/StockView.vue'),
    meta: { title: 'Остатки на складе', perm: 'stock' },
  },
  {
    path: '/products',
    name: 'products',
    component: () => import('@/views/ProductsView.vue'),
    meta: { title: 'Товары', perm: 'products' },
  },
  {
    path: '/products/:id',
    name: 'product',
    component: () => import('@/views/ProductDetailView.vue'),
    meta: { title: 'Карточка товара', perm: 'products' },
  },
  {
    path: '/categories',
    name: 'categories',
    component: () => import('@/views/CategoriesView.vue'),
    meta: { title: 'Категории', perm: 'categories' },
  },
  {
    path: '/exchange-rates',
    name: 'exchange-rates',
    component: () => import('@/views/ExchangeRatesView.vue'),
    meta: { title: 'Курсы валют', perm: 'exchangeRates' },
  },
  {
    path: '/receipts',
    name: 'receipts',
    component: () => import('@/views/ReceiptsView.vue'),
    meta: { title: 'Приход товара', perm: 'receipts' },
  },
  {
    path: '/receipts/new',
    name: 'receipt-new',
    component: () => import('@/views/ReceiptFormView.vue'),
    meta: { title: 'Новый приход', perm: 'receipts.create' },
  },
  {
    path: '/receipts/:id/edit',
    name: 'receipt-edit',
    component: () => import('@/views/ReceiptFormView.vue'),
    meta: { title: 'Приход', perm: 'receipts.create' },
  },
  {
    path: '/sales',
    name: 'sales',
    component: () => import('@/views/SalesView.vue'),
    meta: { title: 'Продажи', perm: 'sales' },
  },
  {
    path: '/sales/new',
    name: 'sale-new',
    component: () => import('@/views/SaleFormView.vue'),
    meta: { title: 'Новая продажа', perm: 'sales.create' },
  },
  {
    path: '/sales/:id/edit',
    name: 'sale-edit',
    component: () => import('@/views/SaleFormView.vue'),
    meta: { title: 'Продажа', perm: 'sales.create' },
  },
  {
    path: '/writeoffs',
    name: 'writeoffs',
    component: () => import('@/views/WriteoffsView.vue'),
    meta: { title: 'Списания', perm: 'writeoffs' },
  },
  {
    path: '/writeoffs/new',
    name: 'writeoff-new',
    component: () => import('@/views/WriteoffFormView.vue'),
    meta: { title: 'Новое списание', perm: 'writeoffs.create' },
  },
  {
    path: '/writeoffs/:id/edit',
    name: 'writeoff-edit',
    component: () => import('@/views/WriteoffFormView.vue'),
    meta: { title: 'Списание', perm: 'writeoffs.create' },
  },
  {
    path: '/clients',
    name: 'clients',
    component: () => import('@/views/ClientsView.vue'),
    meta: { title: 'Клиенты', perm: 'clients' },
  },
  {
    path: '/clients/:id',
    name: 'client',
    component: () => import('@/views/ClientDetailView.vue'),
    meta: { title: 'Карточка клиента', perm: 'clients' },
  },
  {
    path: '/clients/:id/payment/new',
    name: 'payment-new',
    component: () => import('@/views/PaymentFormView.vue'),
    meta: { title: 'Новый платёж', perm: 'payments.create' },
  },
  {
    path: '/clients/:id/payment/:paymentId/edit',
    name: 'payment-edit',
    component: () => import('@/views/PaymentFormView.vue'),
    meta: { title: 'Платёж', perm: 'payments.create' },
  },
  {
    path: '/suppliers',
    name: 'suppliers',
    component: () => import('@/views/SuppliersView.vue'),
    meta: { title: 'Поставщики', perm: 'suppliers' },
  },
  {
    path: '/debts',
    name: 'debts',
    component: () => import('@/views/DebtsView.vue'),
    meta: { title: 'Долги клиентов', perm: 'debts' },
  },
  {
    path: '/movements',
    name: 'movements',
    component: () => import('@/views/MovementsView.vue'),
    meta: { title: 'Журнал движений', perm: 'movements' },
  },
  {
    path: '/profits',
    name: 'profits',
    component: () => import('@/views/ProfitsView.vue'),
    meta: { title: 'Прибыль', perm: 'profits' },
  },
  {
    path: '/expenses',
    name: 'expenses',
    component: () => import('@/views/ExpensesView.vue'),
    meta: { title: 'Расходы', perm: 'expenses' },
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('@/views/UsersView.vue'),
    meta: { title: 'Сотрудники', perm: 'users' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { title: 'Профиль' },
  },
  {
    path: '/print/sale/:id',
    name: 'print-sale',
    component: () => import('@/views/InvoicePrintView.vue'),
    meta: { title: 'Накладная', perm: 'sales', layout: 'blank' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  if (!auth.isAuthed) return { name: 'login', query: { next: to.fullPath } }
  if (to.meta.perm && !auth.can(to.meta.perm)) return { name: 'dashboard' }
  return true
})

export default router
