import type { MetadataRoute } from 'next'

// Evaluated at request time so the same image can serve the test stand and production.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  if (process.env.NOINDEX !== 'false') {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  return { rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/order', '/account'] } }
}
