/**
 * One-time backfill: kisi bhi consultation_service (Basic ho ya astrologer
 * ki khud banayi "normal" service) ke paas agar consultation_service_variants
 * mein ek bhi row nahi hai, to 5 fixed duration variants (10/30/45/60/90 min,
 * default prices ke saath, 30-min wala isDefault=true) create kar deta hai.
 *
 * Yeh gap kaise bana: purane astrologer-approval flow mein (variant system
 * aane se pehle) Basic Consultation service seedha insert hoti thi bina
 * variants ke. `backfill-basic-services.ts` sirf "Basic service missing hai"
 * wala case cover karta hai — agar service already exist karti thi (bas
 * uske variants nahi the), wo script use skip kar deta tha. Yeh script wahi
 * gap bharta hai, aur Basic + normal dono service types ke liye kaam karta
 * hai (future-proof — koi bhi service jo kabhi bina variants ke ban gayi ho).
 *
 * Run karne ka tareeka (backend folder ke andar se):
 *   npx tsx src/scripts/backfill-missing-variants.ts
 */
import { getDb } from '@/core/database/client'
import {
  consultationServices,
  consultationServiceVariants,
  VARIANT_DURATIONS,
  VARIANT_DEFAULT_PRICES,
} from '@/core/database/schema'
import { eq, notInArray } from 'drizzle-orm'

const DEFAULT_VARIANT_DURATION = 30

async function main() {
  const db = getDb()

  // Saari services fetch karo jinke variants table mein koi row nahi hai —
  // service_id NOT IN (select distinct service_id from variants) se milta hai
  const servicesWithVariants = db
    .selectDistinct({ serviceId: consultationServiceVariants.serviceId })
    .from(consultationServiceVariants)

  const servicesMissingVariants = await db
    .select({
      id: consultationServices.id,
      title: consultationServices.title,
      isBasic: consultationServices.isBasic,
      astrologerId: consultationServices.astrologerId,
    })
    .from(consultationServices)
    .where(notInArray(consultationServices.id, servicesWithVariants))

  console.log(
    `Found ${servicesMissingVariants.length} service(s) with zero variants. Backfilling...`,
  )

  let fixed = 0
  for (const service of servicesMissingVariants) {
    await db.insert(consultationServiceVariants).values(
      VARIANT_DURATIONS.map((duration) => ({
        serviceId: service.id,
        durationMinutes: duration,
        price: VARIANT_DEFAULT_PRICES[duration],
        isDefault: duration === DEFAULT_VARIANT_DURATION,
      })),
    )
    fixed++
    console.log(
      `  -> Backfilled variants for "${service.title}" (${service.isBasic ? 'Basic' : 'normal'}, astrologer ${service.astrologerId})`,
    )
  }

  console.log(`Done. Backfilled ${fixed} service(s) out of ${servicesMissingVariants.length} found.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})