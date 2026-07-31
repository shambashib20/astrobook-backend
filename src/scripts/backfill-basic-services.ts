
/**
 * One-time backfill: purane astrologers (jo naya `createBasic()` wiring aane
 * se PEHLE upgrade ho chuke the) ke paas abhi tak isBasic=true service nahi
 * hai. Yeh script har astrologer check karta hai aur agar unki koi basic
 * service nahi hai, to ek create kar deta hai.
 *
 * Run karne ka tareeka (server folder ke andar se):
 *   npx tsx src/scripts/backfill-basic-services.ts
 */
import { getDb } from '@/core/database/client'
import { users, consultationServices } from '@/core/database/schema'
import { eq, and } from 'drizzle-orm'
import { ServiceRepository } from '@/modules/consultation/repositories/service.repository'

async function main() {
  const db = getDb()
  const serviceRepository = new ServiceRepository(db)

  const astrologers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.isAstrologer, true))

  console.log(`Found ${astrologers.length} astrologer(s). Checking for missing Basic Consultation...`)

  let created = 0
  for (const astro of astrologers) {
    const [existingBasic] = await db
      .select({ id: consultationServices.id })
      .from(consultationServices)
      .where(
        and(
          eq(consultationServices.astrologerId, astro.id),
          eq(consultationServices.isBasic, true),
        ),
      )
      .limit(1)

    if (!existingBasic) {
      await serviceRepository.createBasic(astro.id)
      created++
      console.log(`  -> Created Basic Consultation for ${astro.name ?? astro.id}`)
    }
  }

  console.log(`Done. Created ${created} Basic Consultation(s) out of ${astrologers.length} astrologer(s).`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})