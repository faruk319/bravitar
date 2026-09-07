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
      ...options.headers,
    },
  })

  const body = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(body?.detail || `Request failed (${response.status})`, response.status, body)
  }
  return body
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}
