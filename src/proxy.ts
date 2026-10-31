import { NextResponse } from 'next/server'

/**
 * Runs on every request (Next.js 16 "proxy", formerly middleware).
 *
 * The test stand must never be indexed. This is decided at request time from NOINDEX so
 * that the same Docker image works for the test stand and for production
 * (production sets NOINDEX=false).
 */
export function proxy() {
  const response = NextResponse.next()
  if (process.env.NOINDEX !== 'false') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
