
/**
 * One-time backfill: existing astrologers (jo naye commissionPercentage
 * default se PEHLE approve ho chuke the) ke `meta` object mein
 * commissionPercentage nahi hai. Yeh script sirf un astrologers ko update
 * karta hai jinke meta mein yeh key missing hai — existing meta keys
 * (agar koi hain) preserve rehte hain, sirf commissionPercentage:0 merge
 * hota hai. Idempotent hai — dobara run karne se kuch nahi badlega.
 *
 * Run karne ka tareeka (server folder ke andar se):
 *   npx tsx src/scripts/backfill-commission-percentage.ts
 */
import { getDb } from '@/core/database/client'
import { users } from '@/core/database/schema'
import { and, eq, sql } from 'drizzle-orm'

async function main() {
  const db = getDb()

  const result = await db
    .update(users)
    .set({
      meta: sql`COALESCE(${users.meta}, '{}'::jsonb) || '{"commissionPercentage": 0}'::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(users.isAstrologer, true),
        sql`NOT (COALESCE(${users.meta}, '{}'::jsonb) ? 'commissionPercentage')`,
      ),
    )
    .returning({ id: users.id, name: users.name })

  console.log(`Backfilled commissionPercentage=0 for ${result.length} astrologer(s).`)
  for (const row of result) {
    console.log(`  -> ${row.name ?? row.id}`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
