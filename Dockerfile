# Site + admin panel in one container for Yandex Cloud Serverless Containers.
# Build (see docs/infra/test-stand.md):
#   docker build --platform linux/amd64 --provenance=false --sbom=false \
#     --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t cr.yandex/<registry>/krasikra-web:<tag> .
#
# Runtime environment (set on the container revision, never baked into the image):
#   DATABASE_URL, DATABASE_CA_CERT, PAYLOAD_SECRET, SETTINGS_ENCRYPTION_KEY,
#   SERVER_URL, NOINDEX (true on the test stand), PORT (default 8080).

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat \
  && npm install -g pnpm@10 --no-fund --no-audit
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Dependencies (cached while package.json / lockfile do not change)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 2. Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Payload needs some values to load its config during `next build`; they are throwaway
# placeholders that exist only in this build stage and never reach the final image.
RUN PAYLOAD_SECRET=build-time-placeholder \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    pnpm run build

# 3. Runtime: only the standalone server
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    NOINDEX=true \
    APP_VERSION=${APP_VERSION}

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

# Database migrations are applied by Payload on first start (prodMigrations).
CMD ["node", "server.js"]
