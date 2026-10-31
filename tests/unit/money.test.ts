import { describe, expect, it } from 'vitest'

import {
  displayRubles,
  formatQuantity,
  formatRubles,
  isMultipleOf,
  lineTotal,
  parseQuantity,
  parseRubles,
} from '@/lib/money'

describe('parseRubles / formatRubles', () => {
  it('parses X.Label money strings into kopecks', () => {
    expect(parseRubles('199.00')).toBe(19900)
    expect(parseRubles('0.01')).toBe(1)
    expect(parseRubles('1234.5')).toBe(123450)
    expect(parseRubles('15')).toBe(1500)
    expect(parseRubles('-1.00')).toBe(-100)
    expect(parseRubles(' 7.10 ')).toBe(710)
  })

  it('rejects malformed values instead of guessing', () => {
    for (const bad of ['', 'abc', '1,50', '1.234', '1e3', '--1', '.5']) {
      expect(() => parseRubles(bad)).toThrow(TypeError)
    }
  })

  it('formats kopecks back to the wire format', () => {
    expect(formatRubles(19900)).toBe('199.00')
    expect(formatRubles(1)).toBe('0.01')
    expect(formatRubles(-100)).toBe('-1.00')
    expect(formatRubles(0)).toBe('0.00')
    expect(formatRubles(123456789)).toBe('1234567.89')
  })

  it('round-trips', () => {
    for (const value of ['0.00', '0.99', '10.10', '99999.99']) {
      expect(formatRubles(parseRubles(value))).toBe(value)
    }
  })
})

describe('quantities', () => {
  it('parses up to 3 decimals into thousandths', () => {
    expect(parseQuantity('1')).toBe(1000)
    expect(parseQuantity('0.25')).toBe(250)
    expect(parseQuantity('0.255')).toBe(255)
    expect(parseQuantity(1.5)).toBe(1500)
    expect(() => parseQuantity('0.2555')).toThrow(TypeError)
    expect(() => parseQuantity('-1')).toThrow(TypeError)
  })

  it('formats without trailing zeros', () => {
    expect(formatQuantity(1000)).toBe('1')
    expect(formatQuantity(250)).toBe('0.25')
    expect(formatQuantity(1505)).toBe('1.505')
    expect(formatQuantity(0)).toBe('0')
  })

  it('checks multiple_of', () => {
    expect(isMultipleOf(500, 250)).toBe(true)
    expect(isMultipleOf(600, 250)).toBe(false)
    expect(isMultipleOf(0, 250)).toBe(false)
    expect(isMultipleOf(1000, 1000)).toBe(true)
  })
})

describe('lineTotal — round(quantity × price) to kopecks, half up', () => {
  it('multiplies whole pieces exactly', () => {
    expect(lineTotal(parseQuantity('3'), parseRubles('199.00'))).toBe(59700)
  })

  it('rounds half up', () => {
    // 0.5 × 0.01 = 0.005 → 0.01
    expect(lineTotal(500, 1)).toBe(1)
    // 0.25 kg × 1234.10 = 308.525 → 308.53
    expect(lineTotal(250, 123410)).toBe(30853)
    // 0.333 × 100.00 = 33.30
    expect(lineTotal(333, 10000)).toBe(3330)
    // 0.125 × 0.10 = 0.0125 → 0.01
    expect(lineTotal(125, 10)).toBe(1)
    // 0.375 × 0.02 = 0.0075 → 0.01
    expect(lineTotal(375, 2)).toBe(1)
    // 0.001 × 4.99 = 0.00499 → 0.00
    expect(lineTotal(1, 499)).toBe(0)
  })

  it('does not suffer from floating point', () => {
    // 1.005 × 1.00 = 1.005 → 1.01 (naive Math.round(1.005 * 100) gives 1.00)
    expect(lineTotal(1005, 100)).toBe(101)
  })

  it('refuses negative values', () => {
    expect(() => lineTotal(-1, 100)).toThrow(RangeError)
  })
})

describe('displayRubles', () => {
  it('shows whole rubles without kopecks and partial with two digits', () => {
    expect(displayRubles(19900).replace(/\s/g, ' ')).toBe('199 ₽')
    expect(displayRubles(19950).replace(/\s/g, ' ')).toBe('199,50 ₽')
    expect(displayRubles(1234500).replace(/\s/g, ' ')).toBe('12 345 ₽')
  })
})
