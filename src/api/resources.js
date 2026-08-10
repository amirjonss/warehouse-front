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

export const productStockSummary = () => api.post('/products/summary')

export const changeReceiptStatus = (id, status) => changeStatus('/receipts', id, status)
export const changeSaleStatus = (id, status) => changeStatus('/sales', id, status)
export const changeWriteoffStatus = (id, status) => changeStatus('/writeoffs', id, status)
export const changePaymentStatus = (id, status) => changeStatus('/payments', id, status)
