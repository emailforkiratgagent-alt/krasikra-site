import type { Payload } from 'payload'

/** Arbitrary constant identifying the migration lock of this application. */
const MIGRATION_LOCK_KEY = 7_340_215_001

type PoolClient = { query: (sql: string, params?: unknown[]) => Promise<unknown>; release: () => void }
type Pool = { connect: () => Promise<PoolClient> }
type MigratableDb = {
  pool?: Pool
  migrate: (args: { migrations: unknown[] }) => Promise<void>
}

/**
 * Applies committed migrations when the production server starts.
 *
 * Serverless Containers may start several instances at once; a PostgreSQL advisory lock makes
 * them run migrations one at a time — the first applies them, the rest find nothing to do.
 * (Payload's own `prodMigrations` has no such lock.)
 */
export async function migrateWithLock(payload: Payload, migrations: unknown[]): Promise<void> {
  if (migrations.length === 0) return
  const db = payload.db as unknown as MigratableDb
  if (!db.pool) {
    throw new Error('Database adapter has no connection pool; cannot lock migrations')
  }
  const client = await db.pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      await db.migrate({ migrations })
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}
