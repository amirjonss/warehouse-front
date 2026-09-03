import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api, clearTokens, getAccessToken, setTokens } from '@/api/client'

/**
 * Права ролей. Держим 1:1 с `security:` на бэкенде (см. warehouse-api
 * postman-коллекцию — у каждой папки описано Requires: ROLE_X).
 */
const PERMISSIONS = {
  ROLE_ADMIN: [
    'dashboard',
    'stock',
    'products',
    'products.edit',
    'batches',
    'categories',
    'exchangeRates',
    'receipts',
    'receipts.create',
    'sales',
    'sales.create',
    'writeoffs',
    'writeoffs.create',
    'inventories',
    'inventories.create',
    'inventories.post',
    'suppliers',
    'suppliers.edit',
    'clients',
    'clients.edit',
    'clients.delete',
    'debts',
    'payments.create',
    'movements',
    'profits',
    'expenses',
    'cash',
    'cash.admin',
    'wallet',
    'supplierDebts',
    'supplierPayments.create',
    'reports',
    'users',
    'prices.purchase',
  ],
  ROLE_SALES: [
    'dashboard',
    'stock',
    'products',
    'exchangeRates',
    'sales',
    'sales.create',
    'clients',
    'clients.edit',
    'debts',
    'payments.create',
    'expenses',
    // Считает продавец, проводит владелец.
    'inventories',
    'inventories.create',
    // Свою кассу продавец видит и ведёт; чужие смены и закрытие — только админ.
    'cash',
  ],
}

const ROLE_TITLES = {
  ROLE_ADMIN: 'Администратор',
  ROLE_SALES: 'Продавец',
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null) // { id, email, roles }

  const isAuthed = computed(() => !!user.value)
  const role = computed(() => {
    const roles = user.value?.roles ?? []
    if (roles.includes('ROLE_ADMIN')) return 'ROLE_ADMIN'
    if (roles.includes('ROLE_SALES')) return 'ROLE_SALES'
    return null
  })
  const roleTitle = computed(() => (role.value ? ROLE_TITLES[role.value] : ''))

  function can(perm) {
    if (!role.value) return false
    if (!perm) return true
    return PERMISSIONS[role.value]?.includes(perm) ?? false
  }

  async function fetchCurrentUser() {
    user.value = await api.post('/users/about_me')
  }

  async function login(email, password) {
    const tokens = await api.post('/users/auth', { email, password })
    setTokens(tokens)
    await fetchCurrentUser()
  }

  /** Восстановление сессии по сохранённому токену — вызывается один раз при старте приложения. */
  async function restore() {
    if (!getAccessToken()) return
    try {
      await fetchCurrentUser()
    } catch {
      clearTokens()
      user.value = null
    }
  }

  function logout() {
    clearTokens()
    user.value = null
  }

  return { user, isAuthed, role, roleTitle, can, login, logout, restore, fetchCurrentUser }
})
