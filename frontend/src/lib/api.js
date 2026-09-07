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

/** Posts multipart form data (file uploads), letting the browser set the boundary. */
export async function apiUpload(path, formData) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(body?.detail || `Upload failed (${response.status})`, response.status, body)
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
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
