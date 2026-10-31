/**
 * Money and quantity helpers.
 *
 * Inside the site money is always an integer number of kopecks and quantity is an
 * integer number of thousandths (X.Label allows up to 3 decimals). Conversion to the
 * X.Label string format ("199.00", "0.25") happens only at the API boundary.
 */

export type Kopecks = number
/** Quantity in thousandths of a unit: 1 pc = 1000, 0.25 kg = 250. */
export type Milli = number

const RUBLES_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/
const QUANTITY_RE = /^(\d+)(?:\.(\d{1,3}))?$/

function assertSafe(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} is out of safe integer range: ${value}`)
  }
  return value
}

/** "199.00" → 19900. Accepts "199", "199.5", "-1.00". Throws on anything else. */
export function parseRubles(value: string | number): Kopecks {
  const str = typeof value === 'number' ? String(value) : value.trim()
  const match = RUBLES_RE.exec(str)
  if (!match) {
    throw new TypeError(`Invalid money value: ${JSON.stringify(value)}`)
  }
  const [, sign, whole = '0', fraction = ''] = match
  const kopecks = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return assertSafe(sign === '-' ? -kopecks : kopecks, 'Money')
}

/** 19900 → "199.00" (X.Label wire format). */
export function formatRubles(kopecks: Kopecks): string {
  assertSafe(kopecks, 'Money')
  const sign = kopecks < 0 ? '-' : ''
  const abs = Math.abs(kopecks)
  const rubles = Math.floor(abs / 100)
  const rest = abs % 100
  return `${sign}${rubles}.${String(rest).padStart(2, '0')}`
}

/** "0.250" or 0.25 → 250. Up to 3 decimals, non-negative. */
export function parseQuantity(value: string | number): Milli {
  const str = typeof value === 'number' ? String(value) : value.trim()
  const match = QUANTITY_RE.exec(str)
  if (!match) {
    throw new TypeError(`Invalid quantity: ${JSON.stringify(value)}`)
  }
  const [, whole = '0', fraction = ''] = match
  return assertSafe(Number(whole) * 1000 + Number(fraction.padEnd(3, '0')), 'Quantity')
}

/** 250 → "0.25", 1000 → "1", 1500 → "1.5" (X.Label wire format, no trailing zeros). */
export function formatQuantity(milli: Milli): string {
  assertSafe(milli, 'Quantity')
  if (milli < 0) throw new RangeError('Quantity must not be negative')
  const whole = Math.floor(milli / 1000)
  const fraction = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/**
 * Line total exactly as X.Label checks it: round(quantity × price) to kopecks,
 * half up. Pure integer arithmetic, no floating point.
 */
export function lineTotal(quantity: Milli, price: Kopecks): Kopecks {
  assertSafe(quantity, 'Quantity')
  assertSafe(price, 'Money')
  if (quantity < 0 || price < 0) throw new RangeError('Quantity and price must not be negative')
  const product = assertSafe(quantity * price, 'Line total')
  return Math.floor((product + 500) / 1000)
}

/** True when quantity is a positive multiple of the product's step (`multiple_of`). */
export function isMultipleOf(quantity: Milli, step: Milli): boolean {
  if (step <= 0) return quantity > 0
  return quantity > 0 && quantity % step === 0
}

const wholeRubles = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})
const rublesWithKopecks = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 19900 → "199 ₽", 19950 → "199,50 ₽" — for display only. */
export function displayRubles(kopecks: Kopecks): string {
  assertSafe(kopecks, 'Money')
  const formatter = kopecks % 100 === 0 ? wholeRubles : rublesWithKopecks
  return formatter.format(kopecks / 100)
}
