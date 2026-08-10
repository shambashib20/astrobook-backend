import { getDb } from '@/core/database/client'
import { users } from '@/core/database/schema'
/**
 * Seeds the default admin account (idempotent — safe to re-run).
 * Same underlying logic as create-admin.ts, but credentials come from env
 * vars so it can be wired into a one-off `npm run` step with no args and
 * nothing sensitive committed to source.
 *
 * Run karne ka tareeka (server folder ke andar se):
 *   ADMIN_SEED_EMAIL=admin@astrobook.com ADMIN_SEED_PASSWORD='Abcd@2026' npx tsx src/scripts/seed-admin.ts
 * (or set ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD / ADMIN_SEED_NAME in .env)
 */
import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL
  const password = process.env.ADMIN_SEED_PASSWORD
  const name = process.env.ADMIN_SEED_NAME ?? 'Admin'

  if (!email || !password) {
    console.error('Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD (env or .env) before running this script.')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('ADMIN_SEED_PASSWORD kam se kam 8 characters ka hona chahiye.')
    process.exit(1)
  }

  const db = getDb()
  const passwordHash = await bcrypt.hash(password, 10)

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  if (existing) {
    await db
      .update(users)
      .set({ role: 'admin', passwordHash, updatedAt: new Date() })
      .where(eq(users.id, existing.id))
    console.log(`Updated existing user (${email}) → role=admin, password set.`)
  } else {
    await db.insert(users).values({
      email,
      name,
      role: 'admin',
      passwordHash,
      isOnboarded: true,
    })
    console.log(`Created new admin user: ${email}`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('seed-admin failed:', err)
  process.exit(1)
})
