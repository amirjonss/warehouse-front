import { api } from './client'
import { createResource, changeStatus } from './resource'

export const categories = createResource('/categories')
export const exchangeRates = createResource('/exchange_rates')
export const products = createResource('/products')
export const clients = createResource('/clients')
export const suppliers = createResource('/suppliers')
export const receipts = createResource('/receipts')
export const receiptItems = createResource('/receipt_items')
export const batches = createResource('/batches')
export const sales = createResource('/sales')
export const saleItems = createResource('/sale_items')
export const saleItemAllocations = createResource('/sale_item_allocations')
export const payments = createResource('/payments')
export const paymentAllocations = createResource('/payment_allocations')
export const writeoffs = createResource('/writeoffs')
export const writeoffItems = createResource('/writeoff_items')
export const stockMovements = createResource('/stock_movements')
export const profits = createResource('/profits')
export const debts = createResource('/debts')
export const users = createResource('/users')
export const expenses = createResource('/expenses')
export const cashSessions = createResource('/cash_sessions')
export const cashEntries = createResource('/cash_entries')

export const productStockSummary = () => api.post('/products/summary')
export const productTopSales = (params) => api.post('/products/top-sales', undefined, params)
export const clientDebtSummary = () => api.post('/clients/summary')
export const clientDebtAging = () => api.post('/clients/debt-aging')
export const profitSummary = (params) => api.post('/profits/summary', undefined, params)
export const expenseSummary = (params) => api.post('/expenses/summary', undefined, params)
export const expenseDaily = (params) => api.post('/expenses/daily', undefined, params)

export const changeReceiptStatus = (id, status) => changeStatus('/receipts', id, status)
export const changeSaleStatus = (id, status) => changeStatus('/sales', id, status)
export const changeWriteoffStatus = (id, status) => changeStatus('/writeoffs', id, status)
export const changePaymentStatus = (id, status) => changeStatus('/payments', id, status)

export const changeUserPassword = (id, payload) => api.patch(`/users/${id}/password`, payload)

/** Автораспределение: раскидывает черновик платежа по непогашенным продажам клиента (в валюте платежа, от старых к новым) и сразу проводит. */
export const autoAllocatePayment = (id) => api.post(`/payments/${id}/auto_allocate`)

/* Касса продавца (подотчёт). */

/** Открыть смену. Без user — себе; с user — админ открывает сотруднику. */
export const openCashSession = (user) => api.post('/cash_sessions', user ? { user } : {})
/** Три остатка смены плюс оборот по способам оплаты. */
export const cashSessionSummary = (id) => api.post(`/cash_sessions/${id}/summary`)
/** Продавец фиксирует, что отдал деньги владельцу. Подтверждает потом админ. */
export const declareHandover = (id, payload) => api.post(`/cash_sessions/${id}/handover`, payload)
/** Админ подтверждает приём денег по конкретной строке журнала. */
export const confirmHandover = (entryId) => api.post(`/cash_entries/${entryId}/confirm`)
/** Админ закрывает смену, указав фактически принятые суммы по валютам. */
export const closeCashSession = (id, payload) => api.post(`/cash_sessions/${id}/close`, payload)
/** Сколько наличных на руках у всех продавцов вместе — для дашборда. */
export const cashOnHands = () => api.post('/cash_sessions/on_hands')
