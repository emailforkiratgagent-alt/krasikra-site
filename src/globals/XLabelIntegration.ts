import { ValidationError, type GlobalConfig } from 'payload'

import { denyAll, isAdmin, isAdminUser } from '../access/roles'
import { encryptSecret, getEncryptionKey, maskSecret, SecretKeyError } from '../lib/crypto/secretBox'
import { checkXLabelConnection } from '../lib/xlabel/checkConnection'
import { inspectPublicKey } from '../lib/xlabel/hashCode'
import { parseApiBaseUrl } from '../lib/xlabel/baseUrl'
import {
  invalidateXLabelConfigCache,
  WEB_APP_TOKEN_CONTEXT,
  XLABEL_GLOBAL_SLUG,
  type StoredXLabelIntegration,
} from '../lib/xlabel/settings'

const URL_MESSAGE = 'Введите адрес вида https://example.xlabel.ru (только https)'
const TOKEN_RE = /^[\x21-\x7e]{8,512}$/

function originOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

function fail(path: string, message: string): never {
  throw new ValidationError({ global: XLABEL_GLOBAL_SLUG, errors: [{ path, message }] })
}

/**
 * «Интеграция X.Label»: API address, site token (webAppToken) and the public key for
 * hash_code. Admins only.
 *
 * The token is written through a virtual input field, encrypted with AES-256-GCM
 * (SETTINGS_ENCRYPTION_KEY) into `webAppTokenEncrypted`, and never returned by the API:
 * that field has read/create/update access denied, so only server code using
 * `overrideAccess` (src/lib/xlabel/settings.ts) can read it, and only the beforeChange hook
 * below can write it.
 */
export const XLabelIntegration: GlobalConfig = {
  slug: XLABEL_GLOBAL_SLUG,
  label: 'Интеграция X.Label',
  admin: {
    group: 'Администрирование',
    description:
      'Подключение сайта к X.Label (каталог, цены, заказы, оплата). Значения выдаёт X.Label для каждого проекта: «Тест Камчатка» и боевого — свои.',
  },
  access: {
    read: isAdmin,
    update: isAdmin,
    readVersions: denyAll,
  },
  fields: [
    {
      name: 'apiBaseUrl',
      type: 'text',
      label: 'Адрес сервера X.Label',
      admin: {
        placeholder: 'https://example.xlabel.ru',
        description: 'Адрес без «/api/v1.30» — версию API сайт добавляет сам.',
      },
      validate: (value: string | null | undefined) => {
        if (!value || !value.trim()) return true
        return parseApiBaseUrl(value) ? true : URL_MESSAGE
      },
    },
    {
      name: 'webAppToken',
      type: 'text',
      label: 'Токен сайта (webAppToken)',
      virtual: true,
      admin: {
        autoComplete: 'off',
        placeholder: 'Вставьте новый токен, чтобы заменить сохранённый',
        description:
          'Токен из админки X.Label (поле webAppToken проекта). Хранится зашифрованным и после сохранения больше не показывается. Оставьте поле пустым, чтобы не менять токен. Новые значения начинают действовать на сайте в течение минуты.',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'webAppTokenHint',
          type: 'text',
          label: 'Сохранённый токен',
          admin: { readOnly: true, width: '50%', placeholder: 'не задан' },
        },
        {
          name: 'webAppTokenUpdatedAt',
          type: 'date',
          label: 'Токен обновлён',
          admin: {
            readOnly: true,
            width: '50%',
            date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm' },
          },
        },
      ],
    },
    {
      name: 'webAppTokenEncrypted',
      type: 'text',
      admin: { hidden: true },
      access: { read: denyAll, create: denyAll, update: denyAll },
    },
    {
      name: 'publicKeyPem',
      type: 'textarea',
      label: 'Публичный ключ сайта (PEM)',
      admin: {
        rows: 9,
        placeholder: '-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----',
        description:
          'Содержимое файла web_public.pem от X.Label. Им шифруется идентификатор браузера (hash_code) при входе покупателя. Ключ не секретный.',
      },
    },
    {
      name: 'publicKeyInfo',
      type: 'text',
      label: 'Ключ',
      admin: { readOnly: true, placeholder: 'не задан' },
    },
    {
      name: 'connectionCheck',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/XLabelConnectionCheck#XLabelConnectionCheck',
        },
      },
    },
  ],
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        const previous = (originalDoc ?? {}) as Record<string, unknown>
        const next: Record<string, unknown> = { ...data }

        // API address: trim and drop a pasted "/api/v1.30" suffix. Fields absent from a
        // partial update are left untouched.
        if ('apiBaseUrl' in data) {
          const rawUrl = typeof data.apiBaseUrl === 'string' ? data.apiBaseUrl.trim() : ''
          const parsed = rawUrl ? parseApiBaseUrl(rawUrl) : null
          if (rawUrl && !parsed) fail('apiBaseUrl', URL_MESSAGE)
          next.apiBaseUrl = parsed
        }

        // Site token: encrypt a new one, otherwise keep what is stored. Whatever the client
        // sent for the derived fields is ignored.
        const newToken = typeof data.webAppToken === 'string' ? data.webAppToken.trim() : ''

        // The stored token must not be sent to a different server without re-entering it:
        // otherwise anyone with admin access could read it by pointing the site to their host.
        const oldOrigin = originOf(previous.apiBaseUrl)
        const newOrigin = 'apiBaseUrl' in data ? originOf(next.apiBaseUrl) : oldOrigin
        if (!newToken && previous.webAppTokenEncrypted && newOrigin && newOrigin !== oldOrigin) {
          fail(
            'webAppToken',
            'Адрес сервера X.Label изменился — введите токен сайта заново (сохранённый токен на другой сервер не отправляется).',
          )
        }
        if (newToken) {
          if (!TOKEN_RE.test(newToken)) {
            fail('webAppToken', 'Токен должен быть одной строкой без пробелов, от 8 символов.')
          }
          let key: Buffer
          try {
            key = getEncryptionKey()
          } catch (error) {
            if (error instanceof SecretKeyError) {
              fail(
                'webAppToken',
                'На сервере не задан ключ шифрования SETTINGS_ENCRYPTION_KEY — токен нельзя сохранить. Обратитесь к разработчику.',
              )
            }
            throw error
          }
          next.webAppTokenEncrypted = encryptSecret(newToken, key, WEB_APP_TOKEN_CONTEXT)
          next.webAppTokenHint = maskSecret(newToken)
          next.webAppTokenUpdatedAt = new Date().toISOString()
        } else {
          next.webAppTokenEncrypted = previous.webAppTokenEncrypted ?? null
          next.webAppTokenHint = previous.webAppTokenHint ?? null
          next.webAppTokenUpdatedAt = previous.webAppTokenUpdatedAt ?? null
        }
        delete next.webAppToken

        // Public key: validate and store normalised; describe it for the admin.
        if ('publicKeyPem' in data) {
          const pem = typeof data.publicKeyPem === 'string' ? data.publicKeyPem.trim() : ''
          if (pem) {
            const info = inspectPublicKey(pem)
            if (!info.ok) fail('publicKeyPem', info.error)
            next.publicKeyPem = info.normalizedPem
            next.publicKeyInfo = `RSA ${info.bits} бит · SHA-256 ${info.fingerprint}…`
          } else {
            next.publicKeyPem = null
            next.publicKeyInfo = null
          }
        } else {
          next.publicKeyInfo = previous.publicKeyInfo ?? null
        }

        return next
      },
    ],
    afterChange: [
      () => {
        invalidateXLabelConfigCache()
      },
    ],
  },
  endpoints: [
    {
      // POST /api/globals/xlabel-integration/check-connection
      path: '/check-connection',
      method: 'post',
      handler: async (req) => {
        if (!isAdminUser(req.user)) {
          return Response.json({ error: 'Только для администратора' }, { status: 403 })
        }
        const stored = (await req.payload.findGlobal({
          slug: XLABEL_GLOBAL_SLUG as never,
          overrideAccess: true,
          depth: 0,
          req,
        })) as unknown as StoredXLabelIntegration
        const result = await checkXLabelConnection(stored)
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
      },
    },
  ],
}
