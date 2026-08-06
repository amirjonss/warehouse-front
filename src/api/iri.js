/** Ссылка на ресурс в теле запроса (API Platform ждёт IRI, а не голый id). */
export function iri(resource, id) {
  return `/api/${resource}/${id}`
}

/** Достаёт числовой id из IRI-ссылки, которую отдаёт сервер в ответах (например customer: "/api/clients/12"). */
export function idFromIri(value) {
  if (!value) return null
  if (typeof value === 'object') return value.id ?? null
  const parts = String(value).split('/')
  return parts[parts.length - 1]
}
