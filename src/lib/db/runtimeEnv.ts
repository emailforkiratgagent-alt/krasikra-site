/**
 * Runtime environment checks for the Payload config.
 *
 * The config is evaluated both during `next build` (no real environment) and when the
 * production server starts. Strict checks apply only to the running production server.
 */

/** True inside the running production server (not during `next build`, tests or the CLI). */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && env.NEXT_PHASE !== 'phase-production-build'
}

/**
 * Public address of the site. Read from SERVER_URL (not NEXT_PUBLIC_*: those are inlined
 * at build time, and the same image runs on the test stand and in production).
 * Payload uses it for CSRF origin checks and admin links.
 */
export function resolveServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = (env.SERVER_URL || '').trim().replace(/\/+$/, '')
  if (!url && isProductionRuntime(env)) {
    throw new Error('SERVER_URL is required in production (public site address, e.g. https://krasikra.ru)')
  }
  if (url && !/^https?:\/\/[^/\s]+$/i.test(url)) {
    throw new Error(`SERVER_URL must be an origin like https://krasikra.ru, got "${url}"`)
  }
  return url
}

/**
 * TLS settings for PostgreSQL. Yandex Managed PostgreSQL requires TLS with its CA certificate
 * (DATABASE_CA_CERT, PEM; literal "\n" accepted). In production a missing CA is an error unless
 * DATABASE_SSL=disable is set explicitly (local smoke tests only).
 */
export function resolveDatabaseSsl(
  env: NodeJS.ProcessEnv = process.env,
): { ca: string; rejectUnauthorized: true } | undefined {
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim()
  if (ca) return { ca, rejectUnauthorized: true }
  if (isProductionRuntime(env) && env.DATABASE_SSL !== 'disable') {
    throw new Error(
      'DATABASE_CA_CERT is required in production (TLS to PostgreSQL). Set DATABASE_SSL=disable only for local tests.',
    )
  }
  return undefined
}
