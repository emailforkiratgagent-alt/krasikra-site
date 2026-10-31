import { describe, expect, it } from 'vitest'

import { parseApiBaseUrl } from '@/lib/xlabel/baseUrl'
import { normalizeBaseUrl, XLabelClient } from '@/lib/xlabel/client'
import { isAccessTokenExpired, isLoginDead, isLoginPending, XLabelError } from '@/lib/xlabel/errors'

type Call = { url: URL; init: RequestInit }

/** Fake fetch answering from a queue; records every call. */
function fakeFetch(answers: Array<Response | Error | (() => Promise<Response>)>) {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init })
    const next = answers.shift()
    if (!next) throw new Error('No more fake answers')
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next()
    return next
  }) as typeof fetch
  return { fn, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function client(fetchImpl: typeof fetch) {
  return new XLabelClient({
    baseUrl: 'https://x.example.ru/',
    appToken: 'site-token-123',
    fetch: fetchImpl,
    retryDelayMs: 0,
  })
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name)

describe('normalizeBaseUrl', () => {
  it('strips slashes and a pasted API suffix', () => {
    expect(normalizeBaseUrl(' https://x.ru/ ')).toBe('https://x.ru')
    expect(normalizeBaseUrl('https://x.ru/api/v1.30/')).toBe('https://x.ru')
    expect(normalizeBaseUrl('https://x.ru/api')).toBe('https://x.ru')
    expect(normalizeBaseUrl('https://x.ru/sub/path')).toBe('https://x.ru/sub/path')
  })
})

describe('parseApiBaseUrl', () => {
  const prod = { NODE_ENV: 'production' }
  it('accepts https addresses and strips the API suffix', () => {
    expect(parseApiBaseUrl(' https://x.example.ru/api/v1.30/ ', prod)).toBe('https://x.example.ru')
    expect(parseApiBaseUrl('https://x.example.ru:8443/base/', prod)).toBe('https://x.example.ru:8443/base')
  })
  it('rejects plain http, credentials, query and fragment', () => {
    for (const bad of [
      'http://x.example.ru',
      'https://good.ru@evil.ru',
      'https://u:p@x.ru',
      'https://x.ru?a=1',
      'https://x.ru#',
      'https://x.ru/#/frag',
      'ftp://x.ru',
      'x.ru',
      'https://x .ru',
    ]) {
      expect(parseApiBaseUrl(bad, prod), bad).toBeNull()
    }
  })
  it('allows http://localhost only outside production', () => {
    expect(parseApiBaseUrl('http://localhost:3001', { NODE_ENV: 'development' })).toBe('http://localhost:3001')
    expect(parseApiBaseUrl('http://localhost:3001', prod)).toBeNull()
  })
})

describe('XLabelClient', () => {
  it('refuses to work unconfigured', () => {
    expect(() => new XLabelClient({ baseUrl: '', appToken: 't' })).toThrow(XLabelError)
    expect(() => new XLabelClient({ baseUrl: 'https://x.ru', appToken: '' })).toThrow(XLabelError)
  })

  it('sends the site token and platform=web to /settings and unwraps "response"', async () => {
    const { fn, calls } = fakeFetch([json({ response: { auth_providers: ['telegram'] } })])
    const settings = await client(fn).getSettings()
    expect(settings.auth_providers).toEqual(['telegram'])
    const call = calls[0]!
    expect(call.url.origin + call.url.pathname).toBe('https://x.example.ru/api/v1.30/settings')
    expect(call.url.searchParams.get('platform')).toBe('web')
    expect(header(call, 'X-APP-TOKEN')).toBe('Bearer site-token-123')
    expect(header(call, 'Authorization')).toBe(null)
    expect(call.init.method).toBe('GET')
  })

  it('calls /versions with platform, version and WITHOUT Authorization', async () => {
    const { fn, calls } = fakeFetch([json({ response: { stores: '2026-10-20T09:30:00+03:00' } })])
    await client(fn).getVersions()
    const call = calls[0]!
    expect(call.url.searchParams.get('platform')).toBe('web')
    expect(call.url.searchParams.get('version')).toBe('1.0.0')
    expect(header(call, 'Authorization')).toBe(null)
  })

  it('treats {"error"} with HTTP 200 as an error', async () => {
    const { fn } = fakeFetch([json({ error: 'Доставка по адресу невозможна' }, 200)])
    const promise = client(fn).calcShipment(5, { addressId: 7 }, 'user-token')
    await expect(promise).rejects.toBeInstanceOf(XLabelError)
    await promise.catch((error: XLabelError) => {
      expect(error.kind).toBe('api')
      expect(error.status).toBe(200)
      expect(error.message).toBe('Доставка по адресу невозможна')
      expect(error.isUserFacing).toBe(true)
    })
  })

  it('passes the customer token and query for calc', async () => {
    const { fn, calls } = fakeFetch([json({ response: { address_id: 7, price: '-1.00' } })])
    const result = await client(fn).calcShipment(5, { addressId: 7, storeId: 3 }, 'user-token')
    expect(result.price).toBe('-1.00')
    const call = calls[0]!
    expect(call.url.pathname).toBe('/api/v1.30/shipment_methods/5/calc')
    expect(call.url.searchParams.get('address_id')).toBe('7')
    expect(call.url.searchParams.get('store_id')).toBe('3')
    expect(header(call, 'Authorization')).toBe('Bearer user-token')
  })

  it('classifies 401 texts exactly', async () => {
    const make = (text: string) => new XLabelError('api', text, 401)
    expect(isAccessTokenExpired(make('Access token has expired.'))).toBe(true)
    expect(isAccessTokenExpired(make('Вы не авторизованы'))).toBe(false)
    expect(isAccessTokenExpired(new XLabelError('api', 'Access token has expired.', 200))).toBe(false)
    expect(isLoginPending(make('Номер телефона не подтвержден'))).toBe(true)
    expect(isLoginDead(make('Истек срок действия токена'))).toBe(true)
    expect(isLoginDead(make('Вы не авторизованы'))).toBe(true)
    expect(isLoginDead(make('Номер телефона не подтвержден'))).toBe(false)
  })

  it('retries a GET once on 5xx and network errors', async () => {
    const { fn, calls } = fakeFetch([new Response('oops', { status: 502 }), json({ response: [] })])
    expect(await client(fn).getStores()).toEqual([])
    expect(calls).toHaveLength(2)

    const second = fakeFetch([new TypeError('fetch failed'), new TypeError('fetch failed')])
    await expect(client(second.fn).getStores()).rejects.toMatchObject({ kind: 'network' })
    expect(second.calls).toHaveLength(2)
  })

  it('does not retry business errors', async () => {
    const { fn, calls } = fakeFetch([json({ error: 'Магазин не найден' }, 404)])
    await expect(client(fn).getStore(99)).rejects.toMatchObject({ kind: 'api', status: 404 })
    expect(calls).toHaveLength(1)
  })

  it('never retries a POST (orders, one-time login tokens)', async () => {
    const { fn, calls } = fakeFetch([new Response('', { status: 503 })])
    await expect(client(fn).completeMessengerLogin('telegram', 'id-token', 'hash')).rejects.toMatchObject({
      kind: 'http',
      status: 503,
    })
    expect(calls).toHaveLength(1)
  })

  it('sends login polling as a form with hash_code in the query', async () => {
    const pair = { access_token: 'a', refresh_token: 'r', expires_in: 1, token_type: 'bearer' }
    const { fn, calls } = fakeFetch([json({ response: pair })])
    expect(await client(fn).completeMessengerLogin('max', 'id-1', 'HASH+/=')).toEqual(pair)
    const call = calls[0]!
    expect(call.url.pathname).toBe('/api/v1.30/token/max')
    expect(call.url.searchParams.get('hash_code')).toBe('HASH+/=')
    expect(header(call, 'Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(String(call.init.body)).toBe('id_token=id-1')
    expect(call.init.method).toBe('POST')
  })

  it('sends orders as JSON with platform=web', async () => {
    const { fn, calls } = fakeFetch([json({ response: { id: 10 } })])
    await client(fn).createOrder({ store: 1 } as never, 'user-token')
    const call = calls[0]!
    expect(header(call, 'Content-Type')).toBe('application/json')
    expect(JSON.parse(String(call.init.body))).toEqual({ store: 1, platform: 'web' })
  })

  it('reads payments/init without the response wrapper', async () => {
    const { fn, calls } = fakeFetch([
      json({ orderId: 'sber-1', formUrl: 'https://pay.example/form', order_number: '10' }),
    ])
    const result = await client(fn).initPayment(10, 'desktop', 'user-token')
    expect(result.formUrl).toBe('https://pay.example/form')
    expect(String(calls[0]!.init.body)).toBe('platform=web&page_view=desktop')
  })

  it('reports Sber gateway failures from payments/init', async () => {
    const { fn } = fakeFetch([json({ errorCode: '1', errorMessage: 'Заказ уже оплачен' })])
    await expect(client(fn).initPayment(10, 'mobile', 'u')).rejects.toMatchObject({
      kind: 'api',
      message: 'Заказ уже оплачен',
    })
  })

  it('reports non-JSON and unexpected shapes', async () => {
    const html = fakeFetch([new Response('<html>', { status: 200 })])
    await expect(client(html.fn).getSettings()).rejects.toMatchObject({ kind: 'parse' })
    const shape = fakeFetch([json({ data: 1 })])
    await expect(client(shape.fn).getSettings()).rejects.toMatchObject({ kind: 'parse' })
    const notFound = fakeFetch([new Response('<html>404</html>', { status: 404 })])
    await expect(client(notFound.fn).getSettings()).rejects.toMatchObject({ kind: 'http', status: 404 })
  })

  it('treats a connection broken while reading the body as transient', async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'))
          },
        }),
        { status: 200 },
      )
    const { fn, calls } = fakeFetch([broken(), broken()])
    await expect(client(fn).getSettings()).rejects.toMatchObject({ kind: 'network' })
    expect(calls).toHaveLength(2)
  })

  it('times out', async () => {
    const slow = (async (_input: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof fetch
    const c = new XLabelClient({
      baseUrl: 'https://x.ru',
      appToken: 't',
      fetch: slow,
      timeoutMs: 20,
      retryDelayMs: 0,
    })
    await expect(c.getSettings()).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('never puts tokens into error messages', async () => {
    const { fn } = fakeFetch([new Response('', { status: 500 }), new Response('', { status: 500 })])
    const error = (await client(fn)
      .getPeople('user-secret-token')
      .catch((e: unknown) => e)) as XLabelError
    expect(String(error.message + error.endpoint).includes('secret')).toBe(false)
    expect(error.endpoint).toBe('GET /people')
  })
})
