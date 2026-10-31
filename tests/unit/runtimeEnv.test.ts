import { describe, expect, it } from 'vitest'

import { isProductionRuntime, resolveDatabaseSsl, resolveServerUrl } from '@/lib/db/runtimeEnv'

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv
const prod = { NODE_ENV: 'production' }
const build = { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }

describe('runtime environment', () => {
  it('tells the running production server from the build', () => {
    expect(isProductionRuntime(env(prod))).toBe(true)
    expect(isProductionRuntime(env(build))).toBe(false)
    expect(isProductionRuntime(env({ NODE_ENV: 'test' }))).toBe(false)
  })

  it('requires SERVER_URL only at production runtime', () => {
    expect(() => resolveServerUrl(env(prod))).toThrow(/SERVER_URL is required/)
    expect(resolveServerUrl(env(build))).toBe('')
    expect(resolveServerUrl(env({ ...prod, SERVER_URL: 'https://krasikra.ru/' }))).toBe('https://krasikra.ru')
    expect(() => resolveServerUrl(env({ SERVER_URL: 'https://krasikra.ru/shop' }))).toThrow(/origin/)
  })

  it('requires TLS to PostgreSQL at production runtime unless explicitly disabled', () => {
    expect(() => resolveDatabaseSsl(env(prod))).toThrow(/DATABASE_CA_CERT/)
    expect(resolveDatabaseSsl(env({ ...prod, DATABASE_SSL: 'disable' }))).toBe(undefined)
    expect(resolveDatabaseSsl(env(build))).toBe(undefined)
    const ssl = resolveDatabaseSsl(
      env({ ...prod, DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----' }),
    )
    expect(ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    })
  })
})
