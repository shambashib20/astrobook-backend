import { pgTable, uuid, text, boolean, timestamp, pgEnum, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { posts } from './posts'

// ─── Notifications ──────────────────────────────────────────────────────────
// Ek row = ek notification jo kisi user (recipient) ko dikhegi.
//
// userId    → kisko dikhegi (recipient — jiske profile/post pe action hua)
// actorId   → kisne action kiya (follow karne wala / like karne wala) —
//             naam/avatar yahin se store nahi karte, read-time pe users
//             table join karke fresh milta hai (jaise posts.astrologerName
//             pattern) — warna naam badalne pe purani notifications stale
//             reh jaati
// postId    → sirf like/comment type ke liye (kis post pe action hua),
//             follow type ke liye null
//
// 7-din se purani notifications ek cron sweep (server.ts) se delete hoti
// hain — is table ko unbounded grow nahi karne dena, aur purani
// notifications anyway user ke liye relevant nahi rehtin.

export const notificationTypeEnum = pgEnum('notification_type', [
  'new_follower',
  'post_liked',
  'post_commented',
])

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // "Mere notifications" — list ke liye hamesha userId + createdAt DESC
    userIdCreatedAtIdx: index('notifications_user_id_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
    // 7-day cleanup sweep sirf createdAt pe filter karta hai (sabhi users
    // ke across) — alag index taaki woh query bhi fast rahe
    createdAtIdx: index('notifications_created_at_idx').on(table.createdAt),
  }),
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
