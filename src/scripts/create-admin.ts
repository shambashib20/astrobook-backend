import { getDb } from '@/core/database/client'
import { users } from '@/core/database/schema'
/**
 * Ek admin user banao ya existing user ko admin bana ke password set karo.
 * Admin panel email+password se login karta hai — yeh script wahi credentials
 * set karta hai (koi self-serve "become admin" flow nahi hai, jaan-boojh ke).
 *
 * Run karne ka tareeka (server folder ke andar se):
 *   npx tsx src/scripts/create-admin.ts <email> <password> [name]
 *
 * Example:
 *   npx tsx src/scripts/create-admin.ts admin@astrobook.com "SuperSecret123!" "Shambo"
 */
import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'

async function main() {
  const [email, password, name] = process.argv.slice(2)

  if (!email || !password) {
    console.error('Usage: npx tsx src/scripts/create-admin.ts <email> <password> [name]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Password kam se kam 8 characters ka hona chahiye.')
    process.exit(1)
  }

  const db = getDb()
  const passwordHash = await bcrypt.hash(password, 10)

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  if (existing) {
    await db
      .update(users)
      .set({ role: 'admin', passwordHash, name: name ?? existing.name, updatedAt: new Date() })
      .where(eq(users.id, existing.id))
    console.log(`Updated existing user (${email}) → role=admin, password set.`)
  } else {
    await db.insert(users).values({
      email,
      name: name ?? 'Admin',
      role: 'admin',
      passwordHash,
      isOnboarded: true,
    })
    console.log(`Created new admin user: ${email}`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('create-admin failed:', err)
  process.exit(1)
})
