import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/config/env'
import { pushLog } from '@/core/utils/log-buffer'
import * as schema from './schema'

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      // Neon (serverless Postgres) koi query na aaye to ~5 min baad compute
      // suspend kar deta hai — aur yahi hum chahte hain, free/pay-as-you-go
      // plan pe billing sirf jaage hue compute ki hoti hai. Pehle yahan har
      // 4 min ek `SELECT 1` keep-alive tha jo DB ko kabhi sone nahi deta tha
      // (backend 24x7 jaaga ho to Neon bhi 24x7 = free compute limit mahine
      // ke beech khatam). Wo hata diya: suspend ke baad pehli query pe Neon
      // khud jaag jaata hai, bas us ek request pe thoda extra delay hota hai.
      //
      // Idle connections jaldi band karo taaki khuli padi connections compute
      // ko jagaye na rakhein.
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000, // cold compute ke wake-up ke liye thoda margin
      keepAlive: true,
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
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

export type Database = ReturnType<typeof getDb>