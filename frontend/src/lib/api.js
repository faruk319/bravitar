import { academyHeader } from './academy'
import { supabase } from './supabase'

/**
 * Calls the Bravitar API with the current Supabase access token attached.
 * Requests go to the same origin, so the Host header (<slug>.localhost) is
 * what tells the backend which organization this request belongs to.
 */
export async function apiFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...academyHeader(),
      ...options.headers,
    },
  })

  const body = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(errorMessage(body, response.status), response.status, body)
  }
  return body
}

/**
 * Turns a DRF error body into something worth showing a person.
 *
 * Permission errors arrive as {detail}, but field validation arrives as
 * {field: ["message"]} — and that's most of them: an overpaid invoice, a full
 * batch, a double-booked lane. Reading only `detail` reduced every one of
 * those to "Request failed (400)" and threw away the actual reason.
 */
export function errorMessage(body, status) {
  if (!body) return `Request failed (${status})`
  if (typeof body === 'string') return body
  if (body.detail) return body.detail

  const messages = Object.entries(body).flatMap(([field, value]) => {
    const texts = Array.isArray(value) ? value : [value]
    return texts
      .filter((text) => typeof text === 'string')
      .map((text) =>
        // A field name adds nothing when the message already reads as a
        // sentence about it.
        field === 'non_field_errors' || /^[A-Z]/.test(text) ? text : `${field}: ${text}`,
      )
  })

  return messages.length ? messages.join(' ') : `Request failed (${status})`
}

/**
 * One page of a list endpoint, normalised to {items, count, next, previous}.
 * Tolerates a bare array so unpaginated endpoints work through the same call.
 */
export async function apiPage(path) {
  const body = await apiFetch(path)
  if (Array.isArray(body)) {
    return { items: body, count: body.length, next: null, previous: null }
  }
  return {
    items: body?.results ?? [],
    count: body?.count ?? 0,
    next: body?.next ?? null,
    previous: body?.previous ?? null,
  }
}

/**
 * Every row of a list endpoint, following `next` until it runs out.
 *
 * For the places that genuinely need the whole set — a dropdown, a chart
 * series, a register a coach has to mark. A silently truncated register would
 * mark half a class absent, so those callers must not just take page one.
 */
export async function apiFetchAll(path, { maxPages = 50 } = {}) {
  const separator = path.includes('?') ? '&' : '?'
  let page = await apiPage(`${path}${separator}page_size=200`)
  const items = [...page.items]

  for (let fetched = 1; page.next && fetched < maxPages; fetched += 1) {
    // DRF returns `next` as an absolute URL built from the Host header. Take
    // only the path and query so the follow-up still goes through the dev
    // proxy on the tenant's own host rather than out to the public name.
    const url = new URL(page.next)
    page = await apiPage(`${url.pathname.replace(/^\/api/, '')}${url.search}`)
    items.push(...page.items)
  }
  return items
}

/** Posts multipart form data (file uploads), letting the browser set the boundary. */
export async function apiUpload(path, formData, method = 'POST') {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...academyHeader(),
    },
    body: formData,
  })

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(errorMessage(body, response.status), response.status, body)
  }
  return body
}

/**
 * Fetches a protected file as an object URL. Progress photos are served only
 * to their owner behind a bearer token, so a plain <img src> can't load them.
 * Callers must revoke the returned URL when done.
 */
export async function apiObjectUrl(path) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const response = await fetch(`/api${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...academyHeader(),
    },
  })
  if (!response.ok) throw new ApiError(`Could not load image (${response.status})`, response.status)
  return URL.createObjectURL(await response.blob())
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}
