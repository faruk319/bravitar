import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Tenancy is subdomain-based (<slug>.bravitar.com), and localStorage is scoped
// per-origin — a session stored on the root domain would be invisible on an
// org's subdomain, forcing a re-login on every hop. Persisting the session in a
// cookie scoped to the parent domain shares it across all subdomains.
const COOKIE_DOMAIN = import.meta.env.VITE_COOKIE_DOMAIN || ''

// Cookies cap out around 4KB and a Supabase session can exceed that, so values
// are split across numbered chunks.
const CHUNK_SIZE = 3000

function readRawCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function writeRawCookie(name, value) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'path=/',
    'SameSite=Lax',
    'max-age=31536000',
  ]
  if (COOKIE_DOMAIN) parts.push(`domain=${COOKIE_DOMAIN}`)
  if (window.location.protocol === 'https:') parts.push('Secure')
  document.cookie = parts.join('; ')
}

function deleteRawCookie(name) {
  const parts = [`${name}=`, 'path=/', 'max-age=0']
  if (COOKIE_DOMAIN) parts.push(`domain=${COOKIE_DOMAIN}`)
  document.cookie = parts.join('; ')
}

const cookieStorage = {
  getItem(key) {
    const chunks = []
    for (let i = 0; ; i += 1) {
      const chunk = readRawCookie(`${key}.${i}`)
      if (chunk === null) break
      chunks.push(chunk)
    }
    return chunks.length ? chunks.join('') : null
  },

  setItem(key, value) {
    this.removeItem(key)
    for (let i = 0; i * CHUNK_SIZE < value.length; i += 1) {
      writeRawCookie(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))
    }
  },

  removeItem(key) {
    for (let i = 0; ; i += 1) {
      if (readRawCookie(`${key}.${i}`) === null) break
      deleteRawCookie(`${key}.${i}`)
    }
  },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: cookieStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
})
