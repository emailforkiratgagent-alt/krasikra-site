import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
  maskSecret,
  parseEncryptionKey,
  SecretDecryptError,
  SecretKeyError,
} from '@/lib/crypto/secretBox'

const key = randomBytes(32)
const CONTEXT = 'test.field'

describe('secretBox', () => {
  it('round-trips and never stores the plaintext', () => {
    const secret = 'super-secret-token-1234'
    const stored = encryptSecret(secret, key, CONTEXT)
    expect(stored.includes(secret)).toBe(false)
    expect(stored.startsWith('v1.')).toBe(true)
    expect(decryptSecret(stored, key, CONTEXT)).toBe(secret)
  })

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('same', key, CONTEXT)).not.toBe(encryptSecret('same', key, CONTEXT))
  })

  it('refuses another key with a clear message', () => {
    const stored = encryptSecret('x-token-value', key, CONTEXT)
    expect(() => decryptSecret(stored, randomBytes(32), CONTEXT)).toThrow(/different SETTINGS_ENCRYPTION_KEY/)
  })

  it('refuses another context (value moved to another field)', () => {
    const stored = encryptSecret('x-token-value', key, CONTEXT)
    expect(() => decryptSecret(stored, key, 'other.field')).toThrow(SecretDecryptError)
  })

  it('detects tampering', () => {
    const stored = encryptSecret('x-token-value', key, CONTEXT)
    const parts = stored.split('.')
    const data = Buffer.from(parts[4]!, 'base64url')
    data[0] = data[0]! ^ 0xff
    parts[4] = data.toString('base64url')
    expect(() => decryptSecret(parts.join('.'), key, CONTEXT)).toThrow(SecretDecryptError)
    expect(() => decryptSecret('garbage', key, CONTEXT)).toThrow(SecretDecryptError)
    // A truncated authentication tag must be rejected, not accepted as a shorter tag.
    const short = stored.split('.')
    short[3] = Buffer.from(short[3]!, 'base64url').subarray(0, 4).toString('base64url')
    expect(() => decryptSecret(short.join('.'), key, CONTEXT)).toThrow(SecretDecryptError)
  })

  it('validates the key from the environment', () => {
    expect(() => getEncryptionKey({} as NodeJS.ProcessEnv)).toThrow(SecretKeyError)
    expect(() => parseEncryptionKey('c2hvcnQ=')).toThrow(/32 bytes/)
    const raw = randomBytes(32).toString('base64')
    expect(getEncryptionKey({ SETTINGS_ENCRYPTION_KEY: raw } as unknown as NodeJS.ProcessEnv).length).toBe(32)
  })

  it('masks secrets showing at most the last 4 characters', () => {
    expect(maskSecret('abcdefghijkl1234')).toBe('••••••••1234')
    expect(maskSecret('short')).toBe('••••••••')
  })
})
