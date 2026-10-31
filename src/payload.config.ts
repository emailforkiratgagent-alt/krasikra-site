import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { ru } from '@payloadcms/translations/languages/ru'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Users } from './collections/Users'
import { XLabelIntegration } from './globals/XLabelIntegration'
import { migrateWithLock } from './lib/db/migrateWithLock'
import { isProductionRuntime, resolveDatabaseSsl, resolveServerUrl } from './lib/db/runtimeEnv'
import { migrations } from './migrations'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Read at runtime (not NEXT_PUBLIC_*), see src/lib/db/runtimeEnv.ts.
const serverURL = resolveServerUrl()

export default buildConfig({
  serverURL,
  secret: process.env.PAYLOAD_SECRET || '',
  telemetry: false,
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: ' — Хозяин Камчатки',
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  i18n: {
    supportedLanguages: { ru },
    fallbackLanguage: 'ru',
  },
  collections: [Users],
  globals: [XLabelIntegration],
  editor: lexicalEditor(),
  graphQL: {
    disable: true,
  },
  csrf: serverURL ? [serverURL] : [],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
      // Do not add sslmode to DATABASE_URL: it would override these settings.
      ssl: resolveDatabaseSsl(),
      max: Number(process.env.DATABASE_POOL_MAX || 5),
    },
    // Schema changes go through committed migrations only. Local experiments can set
    // PAYLOAD_DB_PUSH=true against a throwaway database.
    push: process.env.PAYLOAD_DB_PUSH === 'true',
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  // Committed migrations are applied when the production server starts, one instance at a time.
  onInit: async (payload) => {
    if (isProductionRuntime()) {
      await migrateWithLock(payload, migrations)
    }
  },
  plugins: [],
})
