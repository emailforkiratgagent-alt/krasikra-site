/**
 * Integration settings stored in the "Интеграция X.Label" global of the admin panel.
 *
 * Takes the Payload instance as an argument (instead of importing the config) so it can be
 * used both from Payload hooks/endpoints and from Next.js server code without import cycles.
 */
import type { Payload } from 'payload'

import { decryptSecret, getEncryptionKey, SecretDecryptError, SecretKeyError } from '../crypto/secretBox'
import { XLabelClient, type XLabelClientOptions } from './client'
import { XLabelError } from './errors'
import { encryptHashCode } from './hashCode'

export const XLABEL_GLOBAL_SLUG = 'xlabel-integration'
/** Bound into the ciphertext so the value cannot be moved to another field. */
export const WEB_APP_TOKEN_CONTEXT = 'xlabel-integration.webAppToken'

const CACHE_TTL_MS = 60_000

export type XLabelIntegrationConfig = {
  baseUrl: string
  appToken: string
  publicKeyPem: string | null
}

/** Shape of the stored global as read with overrideAccess (encrypted token included). */
export type StoredXLabelIntegration = {
  apiBaseUrl?: string | null
  webAppTokenEncrypted?: string | null
  publicKeyPem?: string | null
}

let cache: { value: XLabelIntegrationConfig; expiresAt: number } | null = null

export function invalidateXLabelConfigCache(): void {
  cache = null
}

/** Decrypts the stored global into a usable config. Throws XLabelError kind `config`. */
export function resolveXLabelConfig(
  stored: StoredXLabelIntegration,
  env: NodeJS.ProcessEnv = process.env,
): XLabelIntegrationConfig {
  const baseUrl = stored.apiBaseUrl?.trim()
  if (!baseUrl) {
    throw new XLabelError('config', 'X.Label API address is not set in the admin panel')
  }
  if (!stored.webAppTokenEncrypted) {
    throw new XLabelError('config', 'X.Label site token is not set in the admin panel')
  }
  let appToken: string
  try {
    appToken = decryptSecret(stored.webAppTokenEncrypted, getEncryptionKey(env), WEB_APP_TOKEN_CONTEXT)
  } catch (error) {
    if (error instanceof SecretKeyError || error instanceof SecretDecryptError) {
      throw new XLabelError('config', error.message, 0, '', { cause: error })
    }
    throw error
  }
  return { baseUrl, appToken, publicKeyPem: stored.publicKeyPem?.trim() || null }
}

export async function loadXLabelConfig(
  payload: Payload,
  options: { fresh?: boolean } = {},
): Promise<XLabelIntegrationConfig> {
  if (!options.fresh && cache && cache.expiresAt > Date.now()) {
    return cache.value
  }
  const stored = (await payload.findGlobal({
    slug: XLABEL_GLOBAL_SLUG as never,
    overrideAccess: true,
    depth: 0,
  })) as unknown as StoredXLabelIntegration
  const value = resolveXLabelConfig(stored)
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS }
  return value
}

export async function getXLabelClient(
  payload: Payload,
  options: { fresh?: boolean } & Omit<XLabelClientOptions, 'baseUrl' | 'appToken'> = {},
): Promise<XLabelClient> {
  const { fresh, ...clientOptions } = options
  const config = await loadXLabelConfig(payload, { fresh })
  return new XLabelClient({ ...clientOptions, baseUrl: config.baseUrl, appToken: config.appToken })
}

/** Encrypted `hash_code` for a browser id using the key from the admin panel. */
export function hashCodeFor(config: XLabelIntegrationConfig, deviceId: string): string {
  if (!config.publicKeyPem) {
    throw new XLabelError('config', 'X.Label public key is not set in the admin panel')
  }
  return encryptHashCode(deviceId, config.publicKeyPem)
}
