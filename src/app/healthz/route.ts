// Liveness probe for the container. Does not touch the database or X.Label on purpose:
// a slow dependency must not make the platform restart a healthy container.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { status: 'ok', version: process.env.APP_VERSION || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
