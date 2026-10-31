/**
 * The only way the site talks to X.Label Mobile API 1.30. Server-side only: the site token
 * and customer tokens must never reach the browser.
 *
 * Rules implemented here (docs/xlabel, CLAUDE.md):
 * - `X-APP-TOKEN: Bearer <webAppToken>` on every call, `Authorization: Bearer <access_token>`
 *   for customer methods;
 * - success is `{"response": ...}`, failure is `{"error": "..."}` — sometimes with HTTP 200,
 *   so the `error` field is checked regardless of status;
 * - `platform=web` for /settings, /versions, payments/init and orders; `version=1.0.0` for /versions;
 * - /versions is called without `Authorization` (otherwise X.Label records a "login");
 * - only idempotent GETs are retried; POSTs never are (orders, one-time login tokens).
 */
import { XLabelError } from './errors'
import type { components } from './schema'

type Schemas = components['schemas']
export type XLabelSettings = Schemas['Settings']
export type XLabelVersions = Schemas['Versions']
export type XLabelStore = Schemas['Store']
export type XLabelProduct = Schemas['Product']
export type XLabelProductGroup = Schemas['ProductGroup']
export type XLabelPaymentMethod = Schemas['PaymentMethod']
export type XLabelShipmentMethod = Schemas['ShipmentMethod']
export type XLabelShipmentCalc = Schemas['ShipmentCalc']
export type XLabelOrder = Schemas['Order']
export type XLabelOrderInput = Schemas['OrderInput']
export type XLabelPeople = Schemas['People']
export type XLabelPeopleAddress = Schemas['PeopleAddress']
export type XLabelTokenPair = Schemas['TokenPair']
export type XLabelMessengerStart = Schemas['MessengerStart']

export const XLABEL_API_VERSION = '1.30'
export const XLABEL_PLATFORM = 'web'
/** Fixed site version for /versions (X.Label requires the X.Y.Z format). */
export const XLABEL_CLIENT_VERSION = '1.0.0'

export type MessengerProvider = 'telegram' | 'whatsapp' | 'max'
export const MESSENGER_PROVIDERS: readonly MessengerProvider[] = ['telegram', 'whatsapp', 'max']

export type PageView = 'desktop' | 'mobile'

export type PaymentInitResult = {
  orderId: string
  formUrl: string
  return_url?: string
  fail_url?: string
  order_number?: string
  [key: string]: unknown
}

type Scalar = string | number | boolean | null | undefined
type Params = Record<string, Scalar>

export type RequestOptions = {
  query?: Params
  /** application/x-www-form-urlencoded body (most X.Label POST methods). */
  form?: Params
  /** application/json body (orders, addresses). */
  json?: unknown
  /** Customer access token for user methods. */
  accessToken?: string
  /** Return the body as is, without the `response` wrapper (payments/init). */
  raw?: boolean
  timeoutMs?: number
}

export type XLabelClientOptions = {
  /** Server address, e.g. https://kamchatka.example.ru (the /api/v1.30 part is added here). */
  baseUrl: string
  /** Site token (webAppToken). */
  appToken: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Delay before the single retry of a failed GET. */
  retryDelayMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_DELAY_MS = 300

/** Strips trailing slashes and an `/api/vX.Y` suffix an operator may paste by habit. */
export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(\/v\d+(\.\d+)?)?$/i, '')
    .replace(/\/+$/, '')
}

function toSearchParams(params: Params): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  }
  return search
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class XLabelClient {
  readonly baseUrl: string
  readonly apiUrl: string
  private readonly appToken: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly retryDelayMs: number

  constructor(options: XLabelClientOptions) {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? '')
    if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
      throw new XLabelError('config', 'X.Label API address is not configured')
    }
    if (!options.appToken) {
      throw new XLabelError('config', 'X.Label site token is not configured')
    }
    this.baseUrl = baseUrl
    this.apiUrl = `${baseUrl}/api/v${XLABEL_API_VERSION}`
    this.appToken = options.appToken
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  }

  /** Low-level call. Returns the unwrapped `response` (or the raw body with `raw: true`). */
  async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    const attempts = method === 'GET' ? 2 : 1
    let lastError: XLabelError | undefined
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, options)
      } catch (error) {
        if (!(error instanceof XLabelError) || !error.isTransient || attempt === attempts) {
          throw error
        }
        lastError = error
        await sleep(this.retryDelayMs)
      }
    }
    // Unreachable: the loop either returns or throws.
    throw lastError ?? new XLabelError('network', 'Request failed')
  }

  private async requestOnce<T>(method: 'GET' | 'POST', path: string, options: RequestOptions): Promise<T> {
    const endpoint = `${method} ${path}`
    const query = options.query ? toSearchParams(options.query).toString() : ''
    const url = `${this.apiUrl}${path}${query ? `?${query}` : ''}`

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-APP-TOKEN': `Bearer ${this.appToken}`,
    }
    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`
    }

    let body: string | undefined
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    } else if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = toSearchParams(options.form).toString()
    }

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      })
    } catch (error) {
      const name = (error as { name?: string } | null)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new XLabelError('timeout', 'X.Label did not respond in time', 0, endpoint, { cause: error })
      }
      throw new XLabelError('network', 'Could not reach X.Label', 0, endpoint, { cause: error })
    }

    const text = await res.text().catch(() => '')
    let data: unknown = undefined
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = undefined
      }
    }

    // `{"error": "..."}` may come with any status, including 200.
    if (isRecord(data) && typeof data.error === 'string') {
      throw new XLabelError('api', data.error, res.status, endpoint)
    }
    if (!res.ok) {
      throw new XLabelError('http', `X.Label responded with HTTP ${res.status}`, res.status, endpoint)
    }
    if (data === undefined) {
      throw new XLabelError('parse', 'X.Label returned a non-JSON response', res.status, endpoint)
    }
    if (options.raw) {
      return data as T
    }
    if (!isRecord(data) || !('response' in data)) {
      throw new XLabelError('parse', 'X.Label response has no "response" field', res.status, endpoint)
    }
    return data.response as T
  }

  // ---------------------------------------------------------------------------
  // Service
  // ---------------------------------------------------------------------------

  getSettings(): Promise<XLabelSettings> {
    return this.request('GET', '/settings', { query: { platform: XLABEL_PLATFORM } })
  }

  /** Section change dates. Deliberately without `Authorization` (see module docs). */
  getVersions(): Promise<XLabelVersions> {
    return this.request('GET', '/versions', {
      query: { platform: XLABEL_PLATFORM, version: XLABEL_CLIENT_VERSION },
    })
  }

  // ---------------------------------------------------------------------------
  // Stores and catalogue
  // ---------------------------------------------------------------------------

  getStores(): Promise<XLabelStore[]> {
    return this.request('GET', '/stores')
  }

  getStore(id: number): Promise<XLabelStore> {
    return this.request('GET', `/stores/${encodeURIComponent(id)}`)
  }

  /** Nearest store to a saved customer address (straight-line distance). */
  getNearestStore(shipmentAddressId: number, accessToken: string): Promise<XLabelStore> {
    return this.request('GET', '/stores/nearest', {
      query: { shipment_address_id: shipmentAddressId },
      accessToken,
    })
  }

  /** Groups and products. Prices exist only when `store` is given (store price is in `price`). */
  getProducts(params: { store?: number; group?: number } = {}): Promise<{
    groups?: XLabelProductGroup[]
    products?: XLabelProduct[]
  }> {
    return this.request('GET', '/products', { query: params })
  }

  getPaymentMethods(store?: number): Promise<XLabelPaymentMethod[]> {
    return this.request('GET', '/payment_methods', { query: { store } })
  }

  getShipmentMethods(accessToken?: string): Promise<XLabelShipmentMethod[]> {
    return this.request('GET', '/shipment_methods', { accessToken })
  }

  /**
   * Delivery price for a saved address. `price === "-1.00"` means "not available yet, retry
   * in a few seconds"; a refusal comes as `error` (thrown as XLabelError kind `api`).
   */
  calcShipment(
    shipmentMethodId: number,
    params: { addressId: number; storeId?: number },
    accessToken: string,
  ): Promise<XLabelShipmentCalc> {
    return this.request('GET', `/shipment_methods/${encodeURIComponent(shipmentMethodId)}/calc`, {
      query: { address_id: params.addressId, store_id: params.storeId },
      accessToken,
    })
  }

  // ---------------------------------------------------------------------------
  // Messenger login
  // ---------------------------------------------------------------------------

  startMessengerLogin(provider: MessengerProvider, hashCode: string): Promise<XLabelMessengerStart> {
    return this.request('POST', `/token/${provider}/start`, {
      query: { hash_code: hashCode },
      form: { platform: XLABEL_PLATFORM, version: XLABEL_CLIENT_VERSION },
    })
  }

  /**
   * Poll a messenger login. 401 "Номер телефона не подтвержден" — keep polling;
   * "Истек срок действия токена" / "Вы не авторизованы" — stop. `id_token` is one-time.
   */
  completeMessengerLogin(
    provider: MessengerProvider,
    idToken: string,
    hashCode: string,
  ): Promise<XLabelTokenPair> {
    return this.request('POST', `/token/${provider}`, {
      query: { hash_code: hashCode },
      form: { id_token: idToken },
    })
  }

  /**
   * `refresh_token` is one-time and does not expire: call only after 401
   * "Access token has expired.", strictly one at a time per customer, and persist the new
   * pair immediately.
   */
  refreshToken(refreshToken: string): Promise<XLabelTokenPair> {
    return this.request('POST', '/token/refresh', { form: { refresh_token: refreshToken } })
  }

  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------

  getPeople(accessToken: string): Promise<XLabelPeople> {
    return this.request('GET', '/people', { accessToken })
  }

  getAddresses(accessToken: string): Promise<XLabelPeopleAddress[]> {
    return this.request('GET', '/people/addresses', { accessToken })
  }

  // ---------------------------------------------------------------------------
  // Orders and payment
  // ---------------------------------------------------------------------------

  /** Creates an order. X.Label re-checks every price and total to the kopeck. */
  createOrder(input: XLabelOrderInput, accessToken: string): Promise<XLabelOrder> {
    return this.request('POST', '/orders', {
      json: { ...input, platform: XLABEL_PLATFORM },
      accessToken,
    })
  }

  getOrders(accessToken: string, params: { page?: number; perPage?: number } = {}): Promise<XLabelOrder[]> {
    return this.request('GET', '/orders', {
      query: { page: params.page, per_page: params.perPage },
      accessToken,
    })
  }

  getOrder(orderId: number, accessToken: string): Promise<XLabelOrder> {
    return this.request('GET', `/orders/${encodeURIComponent(orderId)}`, { accessToken })
  }

  /** Starts a Sber payment. Returns the gateway answer as is (no `response` wrapper). */
  async initPayment(orderId: number, pageView: PageView, accessToken: string): Promise<PaymentInitResult> {
    const endpoint = `POST /orders/{id}/payments/init`
    const result = await this.request<Record<string, unknown>>(
      'POST',
      `/orders/${encodeURIComponent(orderId)}/payments/init`,
      { form: { platform: XLABEL_PLATFORM, page_view: pageView }, accessToken, raw: true },
    )
    if (typeof result.formUrl !== 'string' || typeof result.orderId !== 'string') {
      // Sber reports its own failures as errorCode / errorMessage.
      const message =
        typeof result.errorMessage === 'string' && result.errorMessage
          ? result.errorMessage
          : 'Payment gateway did not return a payment page'
      throw new XLabelError('api', message, 200, endpoint)
    }
    return result as PaymentInitResult
  }

  /** Confirms the payment after the customer returns: `payment_id` is Sber's `orderId`. */
  confirmPayment(orderId: number, paymentId: string, accessToken: string): Promise<XLabelOrder> {
    return this.request('POST', `/orders/${encodeURIComponent(orderId)}/payments`, {
      form: { payment_id: paymentId },
      accessToken,
    })
  }
}
