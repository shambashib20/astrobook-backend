import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// ─── Category Media ───────────────────────────────────────────────────────────
// Categories khud hardcoded constants hain (DB mein nahi),
// lekin unke hero videos/images admin upload karta hai — yahan store hota hai.
// `id` = category slug (e.g. "numerology", "vastu") — primary key.

export const categoryMedia = pgTable('category_media', {
  id: text('id').primaryKey(), // category slug
  heroVideoUrl: text('hero_video_url'),
  heroImageUrl: text('hero_image_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CategoryMedia = typeof categoryMedia.$inferSelect
export type NewCategoryMedia = typeof categoryMedia.$inferInsert
