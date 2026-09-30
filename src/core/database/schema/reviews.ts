import { sql } from 'drizzle-orm'
import { check, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appointments } from './consultation'
import { users } from './users'

// ─── Reviews ─────────────────────────────────────────────────────────────────
// User apni *completed* consultation ke baad astrologer ko rating (1-5) aur
// optional comment de sakta hai. Ek appointment = maximum ek review (dobara
// submit karne pe wahi review update hoti hai).
//
// astrologer_profiles.rating / total_reviews yahin se recalculate hote hain
// (reviews table hi source of truth hai — incremental average nahi).

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .unique()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ratingRange: check('reviews_rating_range', sql`${table.rating} between 1 and 5`),
    // Astrologer profile pe "latest reviews" + rating summary
    astrologerCreatedAtIdx: index('reviews_astrologer_created_at_idx').on(
      table.astrologerId,
      table.createdAt,
    ),
    // "Maine kin sessions ko review diya" (my-bookings)
    userIdIdx: index('reviews_user_id_idx').on(table.userId),
  }),
)

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert
