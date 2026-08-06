const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8507/api'
const TOKEN_KEY = 'wh_access_token'
const REFRESH_KEY = 'wh_refresh_token'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY)
}

export function setTokens({ accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken)
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

async function parseError(res) {
  let message = res.statusText || `HTTP ${res.status}`
  try {
    const body = await res.json()
    message = body.detail || body.description || body['hydra:description'] || message
  } catch {
    /* тело не JSON — оставляем statusText */
  }
  return new ApiError(message, res.status)
}

let refreshing = null

async function refreshTokens() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new ApiError('Не авторизован', 401)

  const res = await fetch(`${BASE_URL}/users/auth/refreshToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) throw new ApiError('Сессия истекла', 401)

  const tokens = await res.json()
  setTokens(tokens)
  return tokens.accessToken
}

async function request(path, { method = 'GET', body, params, retry = true } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
    }
  }

  const headers = { Accept: 'application/ld+json' }
  if (body !== undefined) {
    headers['Content-Type'] = method === 'PATCH' ? 'application/merge-patch+json' : 'application/ld+json'
  }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && token) {
    if (retry && getRefreshToken()) {
      refreshing ??= refreshTokens().finally(() => (refreshing = null))
      try {
        await refreshing
        return request(path, { method, body, params, retry: false })
      } catch {
        clearTokens()
        window.location.href = '/login'
        throw new ApiError('Сессия истекла, войдите заново', 401)
      }
    }
    clearTokens()
    window.location.href = '/login'
    throw new ApiError('Сессия истекла, войдите заново', 401)
  }

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return null

  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function unwrapCollection(data) {
  if (Array.isArray(data)) return data
  return data?.member ?? data?.['hydra:member'] ?? []
}

export const api = {
  get: (path, params) => request(path, { method: 'GET', params }),
  getCollection: async (path, params) => unwrapCollection(await request(path, { method: 'GET', params })),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
}
