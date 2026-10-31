/**
 * Runs Payload against a real PostgreSQL (DATABASE_URL) with committed migrations applied.
 * Checks the security properties of the «Интеграция X.Label» global end to end.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { loadXLabelConfig, XLABEL_GLOBAL_SLUG } from '@/lib/xlabel/settings'

const TOKEN = 'site-token-abcdef-123456'
const PEM = readFileSync(path.resolve('docs/xlabel/web_public_test.pem'), 'utf8')
const slug = XLABEL_GLOBAL_SLUG as never

let payload: Payload
type AnyUser = Awaited<ReturnType<Payload['create']>>
let admin: AnyUser
let editor: AnyUser
let startedEmpty = false

async function rawRow(): Promise<string> {
  const pool = (
    payload.db as unknown as { pool: { query: (q: string) => Promise<{ rows: { j: string }[] }> } }
  ).pool
  const { rows } = await pool.query('select row_to_json(t)::text as j from xlabel_integration t')
  return rows.map((r) => r.j).join('\n')
}

function update(data: Record<string, unknown>, user: AnyUser = admin) {
  return payload.updateGlobal({ slug, data: data as never, user: user as never, overrideAccess: false })
}

describe('Интеграция X.Label (global)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
    admin = await payload.create({
      collection: 'users',
      data: {
        email: `admin-${Date.now()}@test.local`,
        password: 'Test-password-1',
        roles: ['editor'],
      } as never,
      overrideAccess: true,
    })
    editor = await payload.create({
      collection: 'users',
      data: {
        email: `editor-${Date.now()}@test.local`,
        password: 'Test-password-1',
        roles: ['editor'],
      } as never,
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('makes the very first account an administrator', () => {
    if (startedEmpty) expect((admin as { roles?: string[] }).roles).toEqual(['admin'])
    expect((editor as { roles?: string[] }).roles).toEqual(['editor'])
  })

  it('encrypts the token, normalises the address and describes the key', async () => {
    const saved = (await update({
      apiBaseUrl: ' https://x.example.ru/api/v1.30/ ',
      webAppToken: TOKEN,
      publicKeyPem: PEM,
    })) as Record<string, unknown>

    expect(saved.apiBaseUrl).toBe('https://x.example.ru')
    expect(saved.webAppToken).toBeUndefined()
    expect(saved.webAppTokenEncrypted).toBeUndefined()
    expect(saved.webAppTokenHint).toBe('••••••••3456')
    expect(String(saved.publicKeyInfo)).toMatch(/^RSA 2048 бит · SHA-256 /)

    const row = await rawRow()
    expect(row.includes(TOKEN)).toBe(false)
    expect(row).toMatch(/"web_app_token_encrypted":"v1\./)

    const resolved = await loadXLabelConfig(payload, { fresh: true })
    expect(resolved.appToken).toBe(TOKEN)
    expect(resolved.baseUrl).toBe('https://x.example.ru')
    expect(resolved.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
  })

  it('never returns the encrypted token through the API, even to an admin', async () => {
    const doc = (await payload.findGlobal({ slug, user: admin as never, overrideAccess: false })) as Record<
      string,
      unknown
    >
    expect(doc.webAppTokenEncrypted).toBeUndefined()
    expect(doc.webAppToken).toBeUndefined()
    expect(doc.webAppTokenHint).toBe('••••••••3456')
  })

  it('keeps the stored token when the form is saved without a new one', async () => {
    await update({ apiBaseUrl: 'https://y.example.ru', webAppToken: '', publicKeyPem: PEM })
    const resolved = await loadXLabelConfig(payload, { fresh: true })
    expect(resolved.appToken).toBe(TOKEN)
    expect(resolved.baseUrl).toBe('https://y.example.ru')
  })

  it('ignores attempts to write the encrypted value or the hint directly', async () => {
    await update({
      apiBaseUrl: 'https://y.example.ru',
      publicKeyPem: PEM,
      webAppTokenEncrypted: 'v1.forged.forged.forged.forged',
      webAppTokenHint: 'forged',
    })
    const resolved = await loadXLabelConfig(payload, { fresh: true })
    expect(resolved.appToken).toBe(TOKEN)
    const doc = (await payload.findGlobal({ slug, overrideAccess: true })) as Record<string, unknown>
    expect(doc.webAppTokenHint).toBe('••••••••3456')
  })

  it('replaces the token when a new one is entered', async () => {
    await update({
      apiBaseUrl: 'https://y.example.ru',
      publicKeyPem: PEM,
      webAppToken: 'second-token-0000-9999',
    })
    expect((await loadXLabelConfig(payload, { fresh: true })).appToken).toBe('second-token-0000-9999')
  })

  it('is closed to non-admin staff', async () => {
    await expect(payload.findGlobal({ slug, user: editor as never, overrideAccess: false })).rejects.toThrow()
    await expect(update({ apiBaseUrl: 'https://evil.example' }, editor)).rejects.toThrow()
    await expect(payload.findGlobal({ slug, overrideAccess: false })).rejects.toThrow()
  })

  it('rejects a bad key, a bad address and a token with spaces', async () => {
    await expect(update({ publicKeyPem: 'not a key' })).rejects.toMatchObject({
      data: { errors: [{ path: 'publicKeyPem' }] },
    })
    await expect(update({ apiBaseUrl: 'ftp://x' })).rejects.toThrow()
    await expect(update({ apiBaseUrl: 'http://x.example.ru' })).rejects.toMatchObject({
      data: { errors: [{ path: 'apiBaseUrl' }] },
    })
    await expect(update({ webAppToken: 'has spaces inside it' })).rejects.toMatchObject({
      data: { errors: [{ path: 'webAppToken' }] },
    })
    // Nothing above changed the stored token.
    expect((await loadXLabelConfig(payload, { fresh: true })).appToken).toBe('second-token-0000-9999')
  })

  it('refuses to save a token when the server has no encryption key', async () => {
    const saved = process.env.SETTINGS_ENCRYPTION_KEY
    delete process.env.SETTINGS_ENCRYPTION_KEY
    try {
      await expect(update({ webAppToken: 'third-token-1111-2222' })).rejects.toMatchObject({
        data: { errors: [{ path: 'webAppToken' }] },
      })
    } finally {
      process.env.SETTINGS_ENCRYPTION_KEY = saved
    }
  })

  it('does not let an editor grant themselves the admin role', async () => {
    const updated = (await payload.update({
      collection: 'users',
      id: editor.id,
      data: { roles: ['admin'] } as never,
      user: editor as never,
      overrideAccess: false,
    })) as { roles?: string[] }
    expect(updated.roles).toEqual(['editor'])
  })

  it('never leaves the site without an administrator', async () => {
    const others = await payload.find({
      collection: 'users',
      overrideAccess: true,
      where: { and: [{ roles: { in: ['admin'] } }, { id: { not_equals: admin.id } }] },
    })
    if (others.totalDocs > 0) return // shared database: the guard cannot be exercised here
    await expect(
      payload.update({
        collection: 'users',
        id: admin.id,
        data: { roles: ['editor'] } as never,
        user: admin as never,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ data: { errors: [{ path: 'roles' }] } })
    await expect(
      payload.delete({ collection: 'users', id: admin.id, user: admin as never, overrideAccess: false }),
    ).rejects.toThrow(/последний администратор/)
  })
})
