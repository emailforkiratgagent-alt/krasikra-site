import { normalizeBaseUrl } from './client'

/**
 * Validates and normalises the X.Label server address entered in the admin panel.
 *
 * Only `https://host[:port][/path]`: the site token travels in a request header, so no
 * plain HTTP (except localhost outside production, for development), no credentials
 * (`https://good@evil`), no query or fragment (they would swallow the `/api/v1.30/...` path).
 * A pasted `/api/v1.30` suffix is removed. Returns null for an unacceptable address.
 */
export function parseApiBaseUrl(
  raw: string,
  env: { NODE_ENV?: string } = process.env,
): string | null {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const allowHttp = isLocal && env.NODE_ENV !== 'production'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp)) return null
  if (url.username || url.password) return null
  if (url.search || url.hash || value.includes('?') || value.includes('#')) return null
  if (!url.hostname) return null
  const path = url.pathname === '/' ? '' : url.pathname
  return normalizeBaseUrl(`${url.protocol}//${url.host}${path}`)
}
