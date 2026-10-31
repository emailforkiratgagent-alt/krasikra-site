/**
 * Errors from X.Label calls.
 *
 * - `api`     — X.Label answered `{"error": "..."}` (sometimes with HTTP 200!). `message` is the
 *               server text, written for the customer, in Russian.
 * - `http`    — non-2xx status without a readable `error` field.
 * - `network` — the request did not reach X.Label (DNS, connection reset, TLS).
 * - `timeout` — no answer within the timeout.
 * - `parse`   — the answer is not the JSON we expect.
 * - `config`  — the integration is not configured in the admin panel.
 */
export type XLabelErrorKind = 'api' | 'http' | 'network' | 'timeout' | 'parse' | 'config'

export class XLabelError extends Error {
  readonly kind: XLabelErrorKind
  /** HTTP status, 0 when there was no response. */
  readonly status: number
  /** Request method and path without query string (query may carry identifiers). */
  readonly endpoint: string

  constructor(kind: XLabelErrorKind, message: string, status = 0, endpoint = '', options?: ErrorOptions) {
    super(message, options)
    this.name = 'XLabelError'
    this.kind = kind
    this.status = status
    this.endpoint = endpoint
  }

  /** The server returned a business error meant to be shown to the customer. */
  get isUserFacing(): boolean {
    return this.kind === 'api'
  }

  /** Worth retrying later: network problems, timeouts, 5xx. */
  get isTransient(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || (this.kind === 'http' && this.status >= 500)
  }
}

// Exact server texts we must react to (see docs/xlabel/requirements.md).
export const XLABEL_MESSAGES = {
  accessTokenExpired: 'Access token has expired.',
  phoneNotConfirmed: 'Номер телефона не подтвержден',
  loginTokenExpired: 'Истек срок действия токена',
  notAuthorized: 'Вы не авторизованы',
} as const

function is401(error: unknown, text: string): boolean {
  return error instanceof XLabelError && error.status === 401 && error.message.trim() === text
}

/** Only this error means "refresh the access token" — never refresh on other 401s. */
export function isAccessTokenExpired(error: unknown): boolean {
  return is401(error, XLABEL_MESSAGES.accessTokenExpired)
}

/** Messenger login not confirmed yet — keep polling. */
export function isLoginPending(error: unknown): boolean {
  return is401(error, XLABEL_MESSAGES.phoneNotConfirmed)
}

/** Messenger login is dead (expired or already used) — stop polling, offer to start again. */
export function isLoginDead(error: unknown): boolean {
  return is401(error, XLABEL_MESSAGES.loginTokenExpired) || is401(error, XLABEL_MESSAGES.notAuthorized)
}
