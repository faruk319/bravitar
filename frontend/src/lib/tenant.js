const BASE_DOMAIN = import.meta.env.VITE_BASE_DOMAIN || 'localhost'

/** The org slug this page is being served under, or null on the root domain. */
export function currentSlug() {
  const host = window.location.hostname
  if (host === BASE_DOMAIN || !host.endsWith(`.${BASE_DOMAIN}`)) return null
  return host.slice(0, -`.${BASE_DOMAIN}`.length) || null
}

export function orgUrl(slug, path = '/') {
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${slug}.${BASE_DOMAIN}${port}${path}`
}

export function rootUrl(path = '/') {
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${BASE_DOMAIN}${port}${path}`
}
