import { pgTable, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── Follows ──────────────────────────────────────────────────────────────────
// followerId → koi bhi user (plain user ya astrologer) ho sakta hai
// followingId → sirf astrologer ho sakta hai (service layer enforce karta
// hai, DB level pe role-conditional FK possible nahi hai Postgres mein)
//
// Ek plain user sirf astrologers ko follow kar sakta — usme khud koi
// "followers" nahi ho sakte (user profile public hi nahi hai). Astrologer
// dusre astrologers ko bhi follow kar sakta hai (peer follow).

export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Duplicate follow avoid — same pair dobara follow karne pe conflict
    followerFollowingUnique: unique().on(table.followerId, table.followingId),
    // "Kisko follow karta hai yeh user" — followerId already unique
    // constraint ka first column hai isliye already indexed
    // "Iske followers kaun hain" — followingId pe alag index chahiye,
    // warna astrologer profile pe followers list/count full scan karegi
    followingIdIdx: index('follows_following_id_idx').on(table.followingId),
  }),
)

export type Follow = typeof follows.$inferSelect
export type NewFollow = typeof follows.$inferInsert
