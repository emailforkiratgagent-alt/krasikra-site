/**
 * Symmetric encryption for secrets stored in the database (e.g. the X.Label site token).
 *
 * AES-256-GCM with a random 96-bit IV. The key comes from the SETTINGS_ENCRYPTION_KEY
 * environment variable (32 random bytes, base64) and never lives in the database or the repo.
 *
 * Stored format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts). `keyId` is a short
 * fingerprint of the key so that a changed key gives a clear error instead of garbage.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretKeyError'
  }
}

export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretDecryptError'
  }
}

/** Parses a base64 key and checks it is exactly 32 bytes. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw || !raw.trim()) {
    throw new SecretKeyError('SETTINGS_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32')
  }
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== KEY_BYTES) {
    throw new SecretKeyError(
      `SETTINGS_ENCRYPTION_KEY must be ${KEY_BYTES} bytes in base64 (got ${key.length}). ` +
        'Generate one with: openssl rand -base64 32',
    )
  }
  return key
}

/** Reads and validates the key from the environment. */
export function getEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  return parseEncryptionKey(env.SETTINGS_ENCRYPTION_KEY)
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 8)
}

/**
 * Encrypts `plaintext`. `context` is bound as additional authenticated data, so a value
 * encrypted for one field cannot be replayed into another.
 */
export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  if (key.length !== KEY_BYTES) throw new SecretKeyError('Encryption key must be 32 bytes')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    keyId(key),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(stored: string, key: Buffer, context: string): string {
  const parts = stored.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new SecretDecryptError('Unknown encrypted value format')
  }
  const [, storedKeyId, ivB64, tagB64, dataB64] = parts as [string, string, string, string, string]
  if (storedKeyId !== keyId(key)) {
    throw new SecretDecryptError(
      'The value was encrypted with a different SETTINGS_ENCRYPTION_KEY; re-enter the secret in the admin panel',
    )
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'))
    decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new SecretDecryptError('Encrypted value is corrupted or was tampered with')
  }
}

/** "abcdef123456" → "••••••••3456". Never reveals more than the last 4 characters. */
export function maskSecret(secret: string): string {
  const visible = secret.length >= 12 ? secret.slice(-4) : ''
  return `${'•'.repeat(8)}${visible}`
}
