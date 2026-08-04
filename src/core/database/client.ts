import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/config/env'
import * as schema from './schema'

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })

    pool.on('error', (err) => {
      // Neon (serverless Postgres) idle connections ko background mein close
      // kar deta hai — ye normal hai, koi fatal cheez nahi. Pehle yahan
      // process.exit(-1) tha jo har idle-timeout pe POORA server crash kar
      // deta tha (ETIMEDOUT / connection terminated jaisi cheezein bhi isi
      // 'error' event se aati hain). `pg` Pool khud hi us bure client ko
      // pool se remove kar deta hai — hume sirf log karna hai, process
      // maarne ki zarurat nahi.
      console.error('DB pool: idle client error (recovered, pool continues)', err.message)
    })
  }
  return pool
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema, logger: env.NODE_ENV === 'development' })
  }
  return db
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

export type Database = ReturnType<typeof getDb>