// Takes desktop and mobile screenshots of the running site for pull request descriptions.
// Usage: BASE=http://127.0.0.1:8080 OUT=/tmp/shots node screenshots.mjs
// Expects an empty database: it creates the first administrator and fills the integration
// settings with obviously fake values (the token is never shown, only its mask).
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8080'
const OUT = process.env.OUT ?? '/tmp/shots'
const PEM_FILE = process.env.PEM_FILE
mkdirSync(OUT, { recursive: true })

async function api(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `JWT ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

const email = 'admin@example.com'
const password = 'screenshot-only-password'
await api('POST', '/api/users/first-register', { email, password, name: 'Администратор' })
const { token } = await api('POST', '/api/users/login', { email, password })
await api(
  'POST',
  '/api/globals/xlabel-integration',
  {
    apiBaseUrl: 'https://test-kamchatka.example.ru',
    webAppToken: 'example-token-1234567890abcdef',
    publicKeyPem: PEM_FILE ? readFileSync(PEM_FILE, 'utf8') : undefined,
  },
  token,
)

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 }, locale: 'ru-RU' },
  mobile: { ...devices['iPhone 13'], locale: 'ru-RU' },
}

const pages = [
  { name: 'home', url: '/', auth: false },
  { name: 'admin-login', url: '/admin/login', auth: false },
  { name: 'admin-xlabel-settings', url: '/admin/globals/xlabel-integration', auth: true },
]

const browser = await chromium.launch()
try {
  for (const [vpName, options] of Object.entries(viewports)) {
    const context = await browser.newContext(options)
    for (const p of pages) {
      await context.clearCookies()
      if (p.auth) {
        const { hostname } = new URL(BASE)
        await context.addCookies([{ name: 'payload-token', value: token, domain: hostname, path: '/' }])
      }
      const page = await context.newPage()
      await page.goto(BASE + p.url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      const file = path.join(OUT, `${p.name}-${vpName}.png`)
      await page.screenshot({ path: file, fullPage: true })
      console.log('saved', file)
      await page.close()
    }
    await context.close()
  }
} finally {
  await browser.close()
}
