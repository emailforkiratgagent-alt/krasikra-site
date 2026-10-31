import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { encryptHashCode, generateDeviceId, inspectPublicKey, isUuidV4 } from '@/lib/xlabel/hashCode'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

describe('hash_code', () => {
  it('generates UUID v4 device ids', () => {
    const id = generateDeviceId()
    expect(isUuidV4(id)).toBe(true)
    expect(isUuidV4('not-a-uuid')).toBe(false)
    // v1 UUID must be rejected
    expect(isUuidV4('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false)
  })

  it('encrypts with RSA-OAEP SHA-256 / MGF1 SHA-256, base64', () => {
    const id = generateDeviceId()
    const hashCode = encryptHashCode(id, publicPem)
    expect(/^[A-Za-z0-9+/]+=*$/.test(hashCode)).toBe(true)
    expect(Buffer.from(hashCode, 'base64').length).toBe(256)
    // What X.Label does on its side:
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(hashCode, 'base64'),
    ).toString('utf8')
    expect(decrypted).toBe(id)
  })

  it('cannot be decrypted with SHA-1 OAEP (wrong scheme must fail)', () => {
    const hashCode = encryptHashCode(generateDeviceId(), publicPem)
    expect(() =>
      privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
        Buffer.from(hashCode, 'base64'),
      ),
    ).toThrow()
  })

  it('refuses non-UUID input', () => {
    expect(() => encryptHashCode('hello', publicPem)).toThrow(TypeError)
  })
})

describe('inspectPublicKey', () => {
  it('accepts the test key issued by X.Label', () => {
    const pem = readFileSync(path.resolve('docs/xlabel/web_public_test.pem'), 'utf8')
    const info = inspectPublicKey(pem)
    expect(info.ok).toBe(true)
    if (info.ok) {
      expect(info.bits).toBe(2048)
      expect(info.fingerprint.split(':')).toHaveLength(8)
      expect(info.normalizedPem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
    }
  })

  it('explains what is wrong', () => {
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const results = [
      inspectPublicKey('hello'),
      inspectPublicKey(privatePem),
      inspectPublicKey('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'),
      inspectPublicKey(
        generateKeyPairSync('rsa', { modulusLength: 1024 })
          .publicKey.export({ type: 'spki', format: 'pem' })
          .toString(),
      ),
      inspectPublicKey(
        generateKeyPairSync('ec', { namedCurve: 'P-256' })
          .publicKey.export({ type: 'spki', format: 'pem' })
          .toString(),
      ),
    ]
    expect(results.map((r) => r.ok)).toEqual([false, false, false, false, false])
    expect(results.every((r) => !r.ok && r.error.length > 10)).toBe(true)
    expect(!results[1]!.ok && results[1]!.error).toMatch(/закрытый ключ/)
    expect(!results[3]!.ok && results[3]!.error).toMatch(/1024/)
  })
})
