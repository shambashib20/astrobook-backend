/**
 * One-time cleanup: naya `cart_items_user_service_unique` constraint
 * (user_id, service_id) add karne se PEHLE yeh chalana zaroori hai — warna
 * agar kisi user ke paas same service ke multiple cart rows already hain
 * (jo `addItem` mein duplicate-check na hone ki wajah se ban gaye the),
 * migration/db:push fail ho jayega constraint violation ke saath.
 *
 * Har (user_id, service_id) group mein sabse latest row (updated_at) rakhta
 * hai, baaki delete kar deta hai.
 *
 * Run karne ka tareeka (backend folder ke andar se):
 *   npx tsx src/scripts/dedupe-cart-items.ts
 *
 * Isके BAAD hi `npm run db:push` (ya jo bhi migration command hai) chalao
 * taaki naya unique constraint apply ho.
 */
import { getDb } from '@/core/database/client'
import { cartItems } from '@/core/database/schema'
import { sql } from 'drizzle-orm'

async function main() {
  const db = getDb()

  const rows = await db
    .select({
      id: cartItems.id,
      userId: cartItems.userId,
      serviceId: cartItems.serviceId,
      updatedAt: cartItems.updatedAt,
    })
    .from(cartItems)

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.userId}::${row.serviceId}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const idsToDelete: string[] = []
  for (const group of groups.values()) {
    if (group.length <= 1) continue
    // Sabse latest wala rakho (jo user ne sabse aakhri mein select kiya tha)
    group.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const [, ...rest] = group
    idsToDelete.push(...rest.map((r) => r.id))
  }

  if (idsToDelete.length === 0) {
    console.log('Koi duplicate cart item nahi mila. Kuch delete karne ki zaroorat nahi.')
    process.exit(0)
  }

  console.log(`${idsToDelete.length} duplicate cart item(s) delete kiye jaa rahe hain...`)
  await db.delete(cartItems).where(sql`${cartItems.id} = ANY(${idsToDelete})`)
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Dedupe failed:', err)
  process.exit(1)
})