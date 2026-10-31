/**
 * `hash_code` — the browser identifier X.Label requires in login methods and in
 * authorised `/versions` calls.
 *
 * The browser gets a UUID v4 in a long-lived httpOnly cookie; the server encrypts it with
 * the site's public key: RSA-2048, OAEP, SHA-256, MGF1 SHA-256, base64.
 * (Node's `oaepHash` sets both the OAEP digest and the MGF1 digest.)
 */
import { constants, createHash, createPublicKey, publicEncrypt, randomUUID } from 'node:crypto'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const MIN_RSA_BITS = 2048

export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value)
}

/** New browser identifier (UUID v4). */
export function generateDeviceId(): string {
  return randomUUID()
}

export function encryptHashCode(deviceId: string, publicKeyPem: string): string {
  if (!isUuidV4(deviceId)) {
    throw new TypeError('Device id must be a UUID v4')
  }
  const encrypted = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(deviceId.toLowerCase(), 'utf8'),
  )
  return encrypted.toString('base64')
}

export type PublicKeyInfo =
  | { ok: true; bits: number; fingerprint: string; normalizedPem: string }
  | { ok: false; error: string }

/**
 * Validates a PEM public key for `hash_code`. Error messages are in Russian because
 * they are shown to the administrator in the admin panel.
 */
export function inspectPublicKey(pem: string): PublicKeyInfo {
  const trimmed = pem.trim()
  if (!trimmed.includes('-----BEGIN')) {
    return {
      ok: false,
      error: 'Это не похоже на ключ в формате PEM: должна быть строка «-----BEGIN PUBLIC KEY-----».',
    }
  }
  if (trimmed.includes('PRIVATE KEY')) {
    return {
      ok: false,
      error:
        'Вставлен закрытый ключ. Нужен публичный (PUBLIC KEY) — закрытый ключ сайту не нужен и хранить его здесь нельзя.',
    }
  }
  let key
  try {
    key = createPublicKey(trimmed)
  } catch {
    return { ok: false, error: 'Не удалось прочитать ключ. Скопируйте файл web_public.pem целиком.' }
  }
  if (key.asymmetricKeyType !== 'rsa') {
    return { ok: false, error: 'Нужен ключ RSA.' }
  }
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0
  if (bits < MIN_RSA_BITS) {
    return { ok: false, error: `Ключ слишком короткий (${bits} бит), нужен RSA от ${MIN_RSA_BITS} бит.` }
  }
  const der = key.export({ type: 'spki', format: 'der' })
  const fingerprint = createHash('sha256').update(der).digest('hex').match(/.{2}/g)!.slice(0, 8).join(':')
  const normalizedPem = key.export({ type: 'spki', format: 'pem' }).toString().trim()
  return { ok: true, bits, fingerprint, normalizedPem }
}
