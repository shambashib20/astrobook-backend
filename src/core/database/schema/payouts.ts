import { pgTable, uuid, numeric, varchar, text, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'

// ── payout_records ─────────────────────────────────────────────────────────
// Admin-created payout entries — one row per settlement to an astrologer.
// status: pending → paid | failed
// amount: rupees (numeric for exact arithmetic, no float drift)

export const payoutRecords = pgTable(
  'payout_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('pending'), // pending | paid | failed
    payoutMethod: varchar('payout_method', { length: 8 }),  // bank | upi
    referenceId: varchar('reference_id', { length: 255 }),  // UTR / transaction ID
    notes: text('notes'),
    periodFrom: timestamp('period_from', { withTimezone: true }),
    periodTo: timestamp('period_to', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    astrologerIdx: index('payout_records_astrologer_idx').on(t.astrologerId),
    statusIdx: index('payout_records_status_idx').on(t.status),
    createdAtIdx: index('payout_records_created_at_idx').on(t.createdAt),
  }),
)
