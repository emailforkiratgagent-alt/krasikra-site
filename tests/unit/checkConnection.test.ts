import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { encryptSecret } from '@/lib/crypto/secretBox'
import { checkXLabelConnection } from '@/lib/xlabel/checkConnection'
import { WEB_APP_TOKEN_CONTEXT } from '@/lib/xlabel/settings'

const key = randomBytes(32)
const env = { SETTINGS_ENCRYPTION_KEY: key.toString('base64') } as unknown as NodeJS.ProcessEnv
const publicKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .publicKey.export({ type: 'spki', format: 'pem' })
  .toString()

const stored = {
  apiBaseUrl: 'https://x.example.ru',
  webAppTokenEncrypted: encryptSecret('site-token-123', key, WEB_APP_TOKEN_CONTEXT),
  publicKeyPem,
}

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('checkXLabelConnection', () => {
  it('reports success with messengers', async () => {
    let seenToken: string | null = null
    const fetchImpl = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      seenToken = new Headers(init.headers).get('X-APP-TOKEN')
      return new Response(JSON.stringify({ response: { auth_providers: ['telegram', 'max', 'apple'] } }))
    }) as typeof fetch
    const result = await checkXLabelConnection(stored, { fetch: fetchImpl, env })
    expect(seenToken).toBe('Bearer site-token-123')
    expect(result.ok).toBe(true)
    expect(result.items.map((i) => i.ok)).toEqual([true, true])
    expect(result.items[0]!.message).toMatch(/telegram, max/)
  })

  it('explains a rejected token', async () => {
    const result = await checkXLabelConnection(stored, {
      fetch: respond({ error: 'Invalid app token' }, 401),
      env,
    })
    expect(result.ok).toBe(false)
    expect(result.items[0]!.message).toMatch(/не принял токен/)
  })

  it('explains a wrong address', async () => {
    const result = await checkXLabelConnection(stored, {
      fetch: (async () => new Response('<html>', { status: 404 })) as unknown as typeof fetch,
      env,
    })
    expect(result.items[0]!.message).toMatch(/нет API X.Label/)
  })

  it('explains missing settings and a changed encryption key', async () => {
    const empty = await checkXLabelConnection({}, { env })
    expect(empty.ok).toBe(false)
    expect(empty.items[0]!.message).toMatch(/Заполните адрес/)

    const otherKey = {
      SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    } as unknown as NodeJS.ProcessEnv
    const rotated = await checkXLabelConnection(stored, { env: otherKey })
    expect(rotated.items[0]!.message).toMatch(/Ключ шифрования на сервере изменился/)
  })

  it('flags a missing public key', async () => {
    const result = await checkXLabelConnection(
      { ...stored, publicKeyPem: null },
      { fetch: respond({ response: { auth_providers: [] } }), env },
    )
    expect(result.ok).toBe(false)
    expect(result.items[1]!.message).toMatch(/Публичный ключ не задан/)
  })
})
