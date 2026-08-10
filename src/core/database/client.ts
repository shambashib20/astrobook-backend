import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/config/env'
import {
  DB_KEEPALIVE_INTERVAL_MS,
  DB_KEEPALIVE_JOB,
  recordCronError,
  recordCronRun,
  recordCronSuccess,
} from '@/core/utils/cron-heartbeat'
import { pushLog } from '@/core/utils/log-buffer'
import * as schema from './schema'

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let keepAliveInterval: ReturnType<typeof setInterval> | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      // Neon (serverless Postgres) suspends its compute after a few
      // minutes with no active query — the request that lands right
      // after that gap pays a full wake-up penalty (300-800ms+) on top
      // of normal latency. Holding the TCP connection open alone doesn't
      // prevent this (Neon suspends based on query activity, not open
      // sockets), so a longer idle timeout plus a periodic ping below is
      // what actually keeps the compute warm between real requests.
      idleTimeoutMillis: 5 * 60_000,
      connectionTimeoutMillis: 5_000,
      keepAlive: true,
    })

    // Reset Neon's inactivity clock every 4 min (under its default 5 min
    // autosuspend window) so real requests don't land on a cold compute.
    // No-op on an already-warm connection — this is just a `SELECT 1`.
    keepAliveInterval = setInterval(
      () => {
        recordCronRun(DB_KEEPALIVE_JOB)
        pool
          ?.query('SELECT 1')
          .then(() => recordCronSuccess(DB_KEEPALIVE_JOB))
          .catch((err) => {
            console.error('DB keep-alive ping failed (non-fatal):', err.message)
            recordCronError(DB_KEEPALIVE_JOB, err)
            pushLog('db', 'error', 'Keep-alive ping failed', { error: err.message })
          })
      },
      DB_KEEPALIVE_INTERVAL_MS,
    )
    keepAliveInterval.unref()

    pool.on('error', (err) => {
      // Neon (serverless Postgres) idle connections ko background mein close
      // kar deta hai — ye normal hai, koi fatal cheez nahi. Pehle yahan
      // process.exit(-1) tha jo har idle-timeout pe POORA server crash kar
      // deta tha (ETIMEDOUT / connection terminated jaisi cheezein bhi isi
      // 'error' event se aati hain). `pg` Pool khud hi us bure client ko
      // pool se remove kar deta hai — hume sirf log karna hai, process
      // maarne ki zarurat nahi.
      console.error('DB pool: idle client error (recovered, pool continues)', err.message)
      pushLog('db', 'error', 'Idle client error (recovered)', { error: err.message })
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
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

export type Database = ReturnType<typeof getDb>