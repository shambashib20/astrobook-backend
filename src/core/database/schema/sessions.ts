import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshToken: text('refresh_token').notNull().unique(),
    deviceInfo: jsonb('device_info').$type<{
      userAgent?: string
      ip?: string
      platform?: string
    }>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb('meta').$type<any>(), // Flexible metadata — accepts any JSON value (string, array, object, etc.)
  },
  (table) => ({
    // Postgres does NOT auto-index FK columns. userId is hit on every
    // login (enforceSessionLimit) and on logout-all / list-sessions —
    // without this it's a full table scan of `sessions` on every request.
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    // enforceSessionLimit orders by createdAt within a user — composite
    // index makes that an index-only scan instead of a sort.
    userIdCreatedAtIdx: index('sessions_user_id_created_at_idx').on(table.userId, table.createdAt),
  }),
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
