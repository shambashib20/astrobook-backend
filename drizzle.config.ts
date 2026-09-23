import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// Migrations DDL run karte hain — Neon ka POOLED connection (pgbouncer,
// transaction mode) DDL/session state ke liye reliably kaam nahi karta.
// Isliye migrations hamesha DIRECT (unpooled) URL se chalni chahiye, app
// runtime (DATABASE_URL, server.ts/client.ts mein) hamesha pooled hi
// rahega — dono ka role alag hai, dono kabhi mix nahi karna.
//
// DIRECT_DATABASE_URL .env mein set karo (Neon dashboard → connection
// string → "Pooled connection" checkbox UNCHECK karke jo URL milta hai).
// Agar set nahi hai to DATABASE_URL pe fallback hota hai (warning ke saath)
// taaki bina setup ke bhi kaam na ruke, lekin production migrations ke
// liye DIRECT_DATABASE_URL zaroor set karna:
//
//   DIRECT_DATABASE_URL="<neon-prod-direct-url>" npm run db:migrate
//
// Isse ab kabhi terminal mein DATABASE_URL manually override nahi karna
// padega — DIRECT_DATABASE_URL hamesha migrations ke liye hi use hota hai.
const directUrl = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? ''

if (!process.env['DIRECT_DATABASE_URL']) {
  console.warn(
    '[drizzle.config] DIRECT_DATABASE_URL set nahi hai — DATABASE_URL (pooled) pe fallback ho raha hai. ' +
      "Neon ka unpooled connection string DIRECT_DATABASE_URL mein daalo, warna migrations pooled connection pe chal sakte hain.",
  )
}

export default defineConfig({
  schema: './src/core/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: directUrl,
  },
  verbose: true,
  strict: true,
})