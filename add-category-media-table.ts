import { sql } from 'drizzle-orm'
import { getDb } from './src/core/database/client'

async function run() {
  const db = getDb()
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "category_media" (
      "id"             text PRIMARY KEY,
      "hero_video_url" text,
      "hero_image_url" text,
      "updated_at"     timestamptz NOT NULL DEFAULT now()
    )
  `)
  console.log('✅ category_media table ready!')
  process.exit(0)
}

run().catch((err) => { console.error(err); process.exit(1) })
