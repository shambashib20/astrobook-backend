import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── Favorites ──────────────────────────────────────────────────────────────
// User ne jo cheezein "pasand" ki (heart dabaya) — ek hi table sab item types
// ke liye. Abhi sirf consultation 'service' hai; courses/products aane par
// bas naya itemType add karna hai (FAVORITE_ITEM_TYPES + favorites.service.ts
// ka resolver), koi naya table nahi.
//
// itemId pe FK jaan-boojh ke nahi hai — alag item types alag tables ki taraf
// point karte hain (polymorphic). Item delete/inactive ho jaaye to list query
// usse chhod deti hai (favorites.service.ts list()).

export const FAVORITE_ITEM_TYPES = ['service'] as const
export type FavoriteItemType = (typeof FAVORITE_ITEM_TYPES)[number]

export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: varchar('item_type', { length: 32 }).notNull(),
    itemId: uuid('item_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Same item dobara favourite nahi ho sakta — add() idempotent rehta hai
    userItemUnique: unique('favorites_user_item_unique').on(
      table.userId,
      table.itemType,
      table.itemId,
    ),
    // "Mere favourites, naye pehle" list ke liye
    userCreatedAtIdx: index('favorites_user_created_at_idx').on(table.userId, table.createdAt),
  }),
)

export type Favorite = typeof favorites.$inferSelect
export type NewFavorite = typeof favorites.$inferInsert
