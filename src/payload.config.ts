import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { ru } from '@payloadcms/translations/languages/ru'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Users } from './collections/Users'
import { XLabelIntegration } from './globals/XLabelIntegration'
import { migrations } from './migrations'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const serverURL = process.env.NEXT_PUBLIC_SERVER_URL?.replace(/\/+$/, '') || ''

/**
 * Yandex Managed PostgreSQL requires TLS with its CA certificate. Put the PEM into
 * DATABASE_CA_CERT (literal "\n" sequences are accepted) and do not add sslmode to DATABASE_URL.
 */
function databaseSsl() {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim()
  return ca ? { ca, rejectUnauthorized: true } : undefined
}

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
      ssl: databaseSsl(),
      max: Number(process.env.DATABASE_POOL_MAX || 5),
    },
    // Schema changes go through committed migrations only. Local experiments can set
    // PAYLOAD_DB_PUSH=true against a throwaway database.
    push: process.env.PAYLOAD_DB_PUSH === 'true',
    migrationDir: path.resolve(dirname, 'migrations'),
    // Applied automatically when the production server starts.
    prodMigrations: migrations,
  }),
  plugins: [],
})
