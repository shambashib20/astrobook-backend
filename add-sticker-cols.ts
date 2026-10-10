import { sql } from 'drizzle-orm'
import { getDb } from './src/core/database/client'

async function run() {
  const db = getDb()
  await db.execute(sql`
    ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS sticker_text       text,
      ADD COLUMN IF NOT EXISTS sticker_x          numeric(5,4),
      ADD COLUMN IF NOT EXISTS sticker_y          numeric(5,4),
      ADD COLUMN IF NOT EXISTS sticker_text_color text,
      ADD COLUMN IF NOT EXISTS sticker_bg_color   text
  `)
  console.log('✅ Sticker columns added!')
  process.exit(0)
}

run().catch((err) => { console.error(err); process.exit(1) })