import { api } from './client'

/** Тонкий CRUD поверх одного ресурса — список/чтение/создание/правка/удаление. */
export function createResource(basePath) {
  return {
    list: (params) => api.getCollection(basePath, params),
    get: (id) => api.get(`${basePath}/${id}`),
    create: (data) => api.post(basePath, data),
    update: (id, data) => api.patch(`${basePath}/${id}`, data),
    remove: (id) => api.delete(`${basePath}/${id}`),
  }
}

export function changeStatus(basePath, id, status) {
  return api.post(`${basePath}/${id}/change_status`, { status })
}
