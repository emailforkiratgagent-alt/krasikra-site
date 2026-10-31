import { XLabelClient } from './client'
import { XLabelError } from './errors'
import { describeErrorForAdmin } from './describeError'
import { generateDeviceId } from './hashCode'
import { hashCodeFor, resolveXLabelConfig, type StoredXLabelIntegration } from './settings'

export type ConnectionCheckItem = { name: string; ok: boolean; message: string }

export type ConnectionCheckResult = {
  ok: boolean
  items: ConnectionCheckItem[]
  authProviders?: string[]
}

/**
 * "Проверить подключение" in the admin panel: decrypts the saved settings, calls
 * GET /settings?platform=web and checks that the public key can encrypt a hash_code.
 * Does not start a login and does not write anything to X.Label.
 */
export async function checkXLabelConnection(
  stored: StoredXLabelIntegration,
  options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<ConnectionCheckResult> {
  const items: ConnectionCheckItem[] = []

  let config
  try {
    config = resolveXLabelConfig(stored, options.env)
  } catch (error) {
    logUnexpected(error)
    items.push({ name: 'Настройки', ok: false, message: describeErrorForAdmin(error) })
    return { ok: false, items }
  }

  let authProviders: string[] | undefined
  try {
    const client = new XLabelClient({
      baseUrl: config.baseUrl,
      appToken: config.appToken,
      fetch: options.fetch,
      timeoutMs: 10_000,
    })
    const settings = await client.getSettings()
    authProviders = Array.isArray(settings.auth_providers) ? settings.auth_providers : []
    const messengers = authProviders.filter((p) => ['telegram', 'whatsapp', 'max'].includes(p))
    items.push({
      name: 'Связь и токен сайта',
      ok: true,
      message: `X.Label отвечает, токен принят. Способы входа: ${
        messengers.length ? messengers.join(', ') : 'мессенджеры не включены'
      }.`,
    })
  } catch (error) {
    logUnexpected(error)
    items.push({
      name: 'Связь и токен сайта',
      ok: false,
      message: describeErrorForAdmin(error, config.baseUrl),
    })
  }

  if (!config.publicKeyPem) {
    items.push({
      name: 'Публичный ключ',
      ok: false,
      message: 'Публичный ключ не задан — вход покупателей работать не будет.',
    })
  } else {
    try {
      hashCodeFor(config, generateDeviceId())
      items.push({
        name: 'Публичный ключ',
        ok: true,
        message: 'Ключ читается, шифрование идентификатора браузера работает.',
      })
    } catch {
      items.push({
        name: 'Публичный ключ',
        ok: false,
        message: 'Ключ не подходит для шифрования. Вставьте файл web_public.pem заново.',
      })
    }
  }

  return { ok: items.every((item) => item.ok), items, authProviders }
}

/**
 * Unexpected (non-X.Label) failures are logged by name and message only: no request URL,
 * headers or cause, which may contain the token or hash_code.
 */
function logUnexpected(error: unknown): void {
  if (error instanceof XLabelError) return
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message.slice(0, 200) : ''
  console.error(`[xlabel] connection check failed unexpectedly: ${name}: ${message}`)
}
