import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  date,
  time,
  text,
  smallint,
  numeric,
  integer,
  pgEnum,
  unique,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── Enums ───────────────────────────────────────────────────────────────────

export const cancelledByEnum = pgEnum('cancelled_by', ['user', 'astrologer'])

export const cancellationRequestStatusEnum = pgEnum('cancellation_request_status', [
  'pending',
  'refunded',
  'credited',
  'timing_changed',       // User ne slot reschedule kiya — refund nahi, booking update ho gayi
  'admin_pending_money',  // User ne money refund choose kiya — admin queue mein
  'admin_pending_wallet', // User ne wallet credit choose kiya — admin queue mein
  'admin_approved',       // Admin ne approve kiya (intermediate step log ke liye)
  'admin_rejected',       // Admin ne reject kiya
])

export const cancellationInitiatedByEnum = pgEnum('cancellation_initiated_by', [
  'astrologer', // Astrologer ne cancel kiya (2 options: refund | wallet)
  'user',       // User ne cancel kiya (3 options: refund | wallet | timing_change)
])

export const walletCreditTypeEnum = pgEnum('wallet_credit_type', ['credit', 'debit'])

export const walletCreditSourceEnum = pgEnum('wallet_credit_source', [
  'cancellation_refund',
  'manual',
  'booking_payment',
])

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'pending', // payment nahi hua abhi
  'confirmed', // payment done, time nahi aaya
  'ongoing', // session chal raha hai
  'completed', // session khatam
  'cancelled', // cancel hua
  'missed', // scheduled time nikal gaya, astrologer kabhi join hi nahi kiya
])

export const bundleStatusEnum = pgEnum('bundle_status', [
  'in_progress', // koi child session ongoing hai
  'paused', // current complete, future child pending
  'completed', // sab khatam
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'success',
  'failed',
  'refunded',
])

export const serviceRequestStatusEnum = pgEnum('service_request_status', [
  'pending',
  'accepted',
  'rejected',
  'expired',
])

// ─── Consultation Services ───────────────────────────────────────────────────

export const consultationServices = pgTable(
  'consultation_services',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  astrologerId: uuid('astrologer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Platform har naye astrologer ke liye ek Basic consultancy auto-create
  // karta hai (admin approval flow mein — jab astrologer application
  // approve hoti hai) — isBasic=true, koi image nahi, fixed starter
  // price/duration jo astrologer baad mein edit kar sakta hai. Baaki saari
  // services astrologer khud banata hai ("normal"), koi Premium/Elite tier
  // nahi hai ab.
  isBasic: boolean('is_basic').notNull().default(false),
  title: varchar('title', { length: 255 }).notNull(),
  shortDescription: varchar('short_description', { length: 500 }).notNull(),
  // Basic consultancy ke liye null (koi photo nahi) — astrologer-created
  // "normal" services ke liye required hai (zod schema level pe enforce).
  coverImage: text('cover_image'),
  about: text('about').notNull(),
  durationMinutes: smallint('duration_minutes').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }),
  // Explore ke categories wale hi tags (e.g. "vedic-astrology", "tarot")
  tags: text('tags')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb('meta').$type<any>(),
  },
  (table) => ({
    // "Get astrologer's services" (astrologer profile page, service list) —
    // unindexed FK, full table scan without this.
    astrologerIdIdx: index('consultation_services_astrologer_id_idx').on(table.astrologerId),
    // Category browsing filters `tag = ANY(tags)` — needs GIN, a btree
    // index can't serve array-containment predicates.
    tagsGinIdx: index('consultation_services_tags_gin_idx').using('gin', table.tags),
  }),
)

// ─── Consultation Service Variants ────────────────────────────────────────────
// Har service (Basic ho ya astrologer-created "normal") ke saath fixed 5
// duration variants auto-create hote hain (10/30/45/60/90 min). Astrologer
// sirf price edit kar sakta hai, duration fixed rehta hai. 30-min wala
// isDefault=true hota hai — user-side detail page pe yehi pre-selected
// rehta hai, baaki 4 recommendation ke tarah niche list hote hain.

export const VARIANT_DURATIONS = [10, 30, 45, 60, 90] as const
export type VariantDurationMinutes = (typeof VARIANT_DURATIONS)[number]

export const VARIANT_DEFAULT_PRICES: Record<VariantDurationMinutes, string> = {
  10: '199',
  30: '399',
  45: '799',
  60: '1099',
  90: '1499',
}

export const consultationServiceVariants = pgTable(
  'consultation_service_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => consultationServices.id, { onDelete: 'cascade' }),
    durationMinutes: smallint('duration_minutes').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    // 30-min variant — user detail page pe by default selected
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueServiceDuration: unique().on(t.serviceId, t.durationMinutes),
  }),
)

// ─── Availability Windows ────────────────────────────────────────────────────

export const availabilityWindows = pgTable(
  'availability_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb('meta').$type<any>(),
  },
  (t) => ({
    // Ek astrologer same date pe multiple time windows rakh sakta hai
    // (11-1pm, 3-5pm, 8-10pm) — sirf EXACT duplicate (same date+start+end)
    // dobara submit hone par overwrite/reactivate hoga.
    uniqueAstrologerDateTime: unique().on(t.astrologerId, t.date, t.startTime, t.endTime),
  }),
)

// ─── Appointments ────────────────────────────────────────────────────────────

export const appointments = pgTable(
  'appointments',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  astrologerId: uuid('astrologer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => consultationServices.id, { onDelete: 'cascade' }),
  // Kaunsa duration/price variant book hua tha (10/30/45/60/90 min) — nullable
  // rakha hai kyunki purani appointments (variant system se pehle ki) is
  // column ke bina hi ban chuki hain.
  variantId: uuid('variant_id').references(() => consultationServiceVariants.id, {
    onDelete: 'set null',
  }),

  // Bundle / parent-child
  parentId: uuid('parent_id').references((): any => appointments.id, { onDelete: 'set null' }),
  bundleStatus: bundleStatusEnum('bundle_status'), // only on parent appointments

  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  durationMinutes: smallint('duration_minutes').notNull(),
  // Booking waqt ke variant ka price snapshot — baad mein astrologer variant
  // ka price change kare toh bhi purani booking ka amount wahi rahe jo
  // booking ke waqt tha. Nullable — purani appointments (variant system se
  // pehle ki) ke liye service.price pe fallback hota hai.
  price: numeric('price', { precision: 10, scale: 2 }),

  // Agora — only populated after payment
  agoraChannel: text('agora_channel'),
  agoraToken: text('agora_token'),
  // Astrologer session mein sabse pehle kab live hua — ye set hote hi user
  // ko join karne diya jaata hai. Purpose: astrologer "green room" ki tarah
  // scheduled time se JOIN_GRACE_MINUTES pehle akela wait kar sakta hai
  // (session duration pe iska asar nahi padta, kyunki endsAt hamesha fixed
  // scheduledAt + duration hai) — lekin user ka asli (Agora) join tab tak
  // block rehta hai jab tak yeh set na ho jaaye.
  astrologerJoinedAt: timestamp('astrologer_joined_at', { withTimezone: true }),
  // "Session starting soon" push reminder duplicate na bheje isliye —
  // ek baar bhej diya toh yahan timestamp set ho jaata hai
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),

  status: appointmentStatusEnum('status').notNull().default('pending'),
  // Jo party ne cancel kiya — astrologer ya user
  cancelledBy: cancelledByEnum('cancelled_by'),
  // Ek booking sirf ek baar reschedule ho sakti hai (per-booking limit)
  rescheduledCount: smallint('rescheduled_count').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb('meta').$type<any>(),
  },
  (table) => ({
    // "My bookings" / booking history — the single most frequently hit
    // query pattern on this table, previously an unindexed FK scan.
    userIdIdx: index('appointments_user_id_idx').on(table.userId),
    // Astrologer calendar/dashboard — same story, plus scheduledAt so
    // "today's sessions" range queries can use the index directly.
    astrologerIdScheduledAtIdx: index('appointments_astrologer_id_scheduled_at_idx').on(
      table.astrologerId,
      table.scheduledAt,
    ),
    serviceIdIdx: index('appointments_service_id_idx').on(table.serviceId),
    // Bundle lookups (parent -> children)
    parentIdIdx: index('appointments_parent_id_idx').on(table.parentId),
  }),
)

// ─── Payments ────────────────────────────────────────────────────────────────

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),

    // Denormalized for fast admin reconciliation queries — avoids joins
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    astrologerId: uuid('astrologer_id').references(() => users.id, { onDelete: 'set null' }),

    // ── Razorpay — active again (Cashfree migration rolled back) ──
    razorpayOrderId: varchar('razorpay_order_id', { length: 255 }),
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 255 }),
    razorpaySignature: varchar('razorpay_signature', { length: 512 }),

    // ── Cashfree (commented out during the Razorpay rollback — kept, not
    // deleted, for a quick re-migration) ──
    // cashfreeOrderId: varchar('cashfree_order_id', { length: 255 }),
    // cashfreePaymentId: varchar('cashfree_payment_id', { length: 255 }),
    // platformCommissionPercentage: numeric('platform_commission_percentage', {
    //   precision: 5,
    //   scale: 2,
    // }),
    // astrologerPayoutAmount: numeric('astrologer_payout_amount', { precision: 10, scale: 2 }),
    // refundStatus: varchar('refund_status', { length: 16 }), // 'pending' | 'processing' | 'success' | 'failed'
    // refundedAmount: numeric('refunded_amount', { precision: 10, scale: 2 }),
    // refundedAt: timestamp('refunded_at', { withTimezone: true }),
    // cashfreeRefundId: varchar('cashfree_refund_id', { length: 255 }),

    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 8 }).notNull().default('INR'),

    // Payment method reported by Razorpay: upi, card, netbanking, wallet, emi
    method: varchar('method', { length: 32 }),

    // Set on webhook payment.captured — unix timestamp from Razorpay
    capturedAt: timestamp('captured_at', { withTimezone: true }),

    // Set on payment.failed — Razorpay error details for self-explanatory failure records
    failureCode: varchar('failure_code', { length: 64 }),
    failureReason: text('failure_reason'),

    status: paymentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appointmentIdIdx: index('payments_appointment_id_idx').on(table.appointmentId),
    userIdIdx: index('payments_user_id_idx').on(table.userId),
    astrologerIdIdx: index('payments_astrologer_id_idx').on(table.astrologerId),
    // Cashfree webhook handler looks payments up by order id — every
    // webhook delivery was a full table scan without this. (Commented out
    // alongside cashfreeOrderId during the Razorpay rollback.)
    // cashfreeOrderIdIdx: index('payments_cashfree_order_id_idx').on(table.cashfreeOrderId),
  }),
)

// ─── Vendor Settlements (Cashfree Easy Split — monthly payout audit) ─────────
// Commented out during the Razorpay rollback (kept, not deleted, for a quick
// re-migration) — no Razorpay equivalent, Route settles per-transfer, not on
// a monthly cron.
// export const vendorSettlements = pgTable(
//   'vendor_settlements',
//   {
//     id: uuid('id').primaryKey().defaultRandom(),
//     astrologerId: uuid('astrologer_id')
//       .notNull()
//       .references(() => users.id, { onDelete: 'cascade' }),
//     cashfreeVendorId: varchar('cashfree_vendor_id', { length: 64 }).notNull(),
//     periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
//     periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
//     status: varchar('status', { length: 16 }).notNull(), // 'success' | 'failed'
//     cashfreeResponse: jsonb('cashfree_response').$type<any>(),
//     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
//   },
//   (table) => ({
//     astrologerIdIdx: index('vendor_settlements_astrologer_id_idx').on(table.astrologerId),
//   }),
// )

// ─── Service Requests (Mid-session upsell) ───────────────────────────────────

export const serviceRequests = pgTable(
  'service_requests',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  parentAppointmentId: uuid('parent_appointment_id')
    .notNull()
    .references(() => appointments.id, { onDelete: 'cascade' }),
  astrologerId: uuid('astrologer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => consultationServices.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => consultationServiceVariants.id, {
    onDelete: 'set null',
  }),
  proposedSlot: timestamp('proposed_slot', { withTimezone: true }).notNull(),
  status: serviceRequestStatusEnum('status').notNull().default('pending'),
  // Once accepted + paid, this links to the new child appointment
  childAppointmentId: uuid('child_appointment_id').references(() => appointments.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    parentAppointmentIdIdx: index('service_requests_parent_appointment_id_idx').on(
      table.parentAppointmentId,
    ),
    astrologerIdIdx: index('service_requests_astrologer_id_idx').on(table.astrologerId),
    userIdIdx: index('service_requests_user_id_idx').on(table.userId),
  }),
)

// ─── Payment Transactions (append-only event ledger) ─────────────────────────
// Never updated — one row per event. Used for reconciliation and dispute
// resolution. rawPayload stores the full Razorpay webhook body as evidence.

export const paymentTransactionEventEnum = pgEnum('payment_transaction_event', [
  'order.created',      // Razorpay order created, user about to pay
  'payment.captured',   // Razorpay webhook: payment.captured
  'payment.failed',     // Razorpay webhook: payment.failed
  'payment.refunded',   // Refund issued (missed session / conflict)
  'verify.success',     // Client-side signature verify succeeded
  'verify.failed',      // Client-side signature verify failed
])

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Links — set null on delete so log survives parent row deletion
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    astrologerId: uuid('astrologer_id').references(() => users.id, { onDelete: 'set null' }),

    // Razorpay identifiers
    razorpayOrderId: varchar('razorpay_order_id', { length: 255 }),
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 255 }),

    // Which lifecycle event this row represents
    event: paymentTransactionEventEnum('event').notNull(),

    // Amount at the time of this event
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 8 }).notNull().default('INR'),

    // Payment method (upi, card, netbanking, wallet, emi) — populated on capture/failed
    method: varchar('method', { length: 32 }),

    // Failure details — only set on payment.failed / verify.failed
    failureCode: varchar('failure_code', { length: 64 }),
    failureReason: text('failure_reason'),

    // Razorpay platform fees — populated on payment.captured from webhook entity
    razorpayFee: numeric('razorpay_fee', { precision: 10, scale: 2 }),
    razorpayTax: numeric('razorpay_tax', { precision: 10, scale: 2 }),

    capturedAt: timestamp('captured_at', { withTimezone: true }),

    // Full Razorpay webhook payload stored as evidence for disputes
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),

    // Immutable — this column is never updated after insert
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Most common lookups: all events for an order, or all events for a user
    orderIdIdx: index('payment_transactions_order_id_idx').on(table.razorpayOrderId),
    userIdIdx: index('payment_transactions_user_id_idx').on(table.userId),
    astrologerIdIdx: index('payment_transactions_astrologer_id_idx').on(table.astrologerId),
    appointmentIdIdx: index('payment_transactions_appointment_id_idx').on(table.appointmentId),
  }),
)

// ─── Recurring Availability ──────────────────────────────────────────────────
// Har hafte repeating slots — e.g. "Har Somvar 10am-1pm". Specific date
// windows ke upar additional availability dete hain (dono combine hote hain
// slot generation mein).

export const recurringAvailability = pgTable(
  'recurring_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // JS-style day of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Ek astrologer same day+time pe dobara submit kare toh upsert se reactivate
    uniqueAstrologerDayTime: unique().on(t.astrologerId, t.dayOfWeek, t.startTime, t.endTime),
  }),
)

// ─── Slot Locks ──────────────────────────────────────────────────────────────
// Book My Show style soft lock — booking screen khulne pe slot 10 min ke
// liye reserve ho jaata hai. TTL expire hone pe ya user page se jaane pe
// auto-release.

export const SLOT_LOCK_TTL_MS = 10 * 60 * 1000 // 10 minutes

export const slotLocks = pgTable(
  'slot_locks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Slot ka exact UTC timestamp
    slotStart: timestamp('slot_start', { withTimezone: true }).notNull(),
    lockedBy: uuid('locked_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Ek slot pe ek hi lock — duplicate insert silently drop ho jaata hai
    uniqueAstrologerSlot: unique().on(t.astrologerId, t.slotStart),
  }),
)

// ─── Cancellation Requests ───────────────────────────────────────────────────
// Jab astrologer kisi confirmed (paid) booking ko cancel kare, toh user ke
// paas 24h ka window hota hai refund ya wallet credit choose karne ke liye.
// Agar 24h mein koi action nahi → auto-refund via cron sweep.

export const CANCELLATION_CHOICE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

export const cancellationRequests = pgTable(
  'cancellation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    // Razorpay refs — nullable ab: user-cancel ke liye required nahi;
    // astrologer-cancel ke liye backward compat ke liye rakha
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 255 }),
    razorpayOrderId: varchar('razorpay_order_id', { length: 255 }),
    // 0 = free window (booking ke 10 min ke andar cancel); 50 = after 10 min
    deductionAmount: integer('deduction_amount').notNull().default(0),
    // User ka UPI ID — money refund choose karne pe fill hota hai
    upiId: varchar('upi_id', { length: 255 }),
    status: cancellationRequestStatusEnum('status').notNull().default('pending'),
    // Kisne cancel kiya — determines how many options to show user
    // (astrologer cancel: 2 options; user cancel: 3 options incl. timing_change)
    initiatedBy: cancellationInitiatedByEnum('initiated_by').notNull().default('astrologer'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appointmentIdIdx: index('cancellation_requests_appointment_id_idx').on(table.appointmentId),
    userIdIdx: index('cancellation_requests_user_id_idx').on(table.userId),
    // Cron sweep: pending + expired rows ka fast lookup
    statusExpiresAtIdx: index('cancellation_requests_status_expires_at_idx').on(
      table.status,
      table.expiresAt,
    ),
  }),
)

// ─── Wallet Credits ───────────────────────────────────────────────────────────
// Closed-loop AstroBook wallet — sirf credit hota hai (cancellation pe), cash
// out nahi hota. Future mein booking pe debit bhi ho sakta hai.

export const walletCredits = pgTable(
  'wallet_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    type: walletCreditTypeEnum('type').notNull(),
    source: walletCreditSourceEnum('source').notNull(),
    // Jo cancellation_request se yeh credit bana — nullable (manual credits)
    cancellationRequestId: uuid('cancellation_request_id').references(
      () => cancellationRequests.id,
      { onDelete: 'set null' },
    ),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('wallet_credits_user_id_idx').on(table.userId),
    cancellationRequestIdIdx: index('wallet_credits_cancellation_request_id_idx').on(
      table.cancellationRequestId,
    ),
  }),
)

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConsultationService = typeof consultationServices.$inferSelect
export type NewConsultationService = typeof consultationServices.$inferInsert

export type ConsultationServiceVariant = typeof consultationServiceVariants.$inferSelect
export type NewConsultationServiceVariant = typeof consultationServiceVariants.$inferInsert

export type AvailabilityWindow = typeof availabilityWindows.$inferSelect
export type NewAvailabilityWindow = typeof availabilityWindows.$inferInsert

export type Appointment = typeof appointments.$inferSelect
export type NewAppointment = typeof appointments.$inferInsert

export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert

// export type VendorSettlement = typeof vendorSettlements.$inferSelect
// export type NewVendorSettlement = typeof vendorSettlements.$inferInsert

export type ServiceRequest = typeof serviceRequests.$inferSelect
export type NewServiceRequest = typeof serviceRequests.$inferInsert

export type PaymentTransaction = typeof paymentTransactions.$inferSelect
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert

export type RecurringAvailability = typeof recurringAvailability.$inferSelect
export type NewRecurringAvailability = typeof recurringAvailability.$inferInsert

export type SlotLock = typeof slotLocks.$inferSelect
export type NewSlotLock = typeof slotLocks.$inferInsert

export type CancellationRequest = typeof cancellationRequests.$inferSelect
export type NewCancellationRequest = typeof cancellationRequests.$inferInsert

export type WalletCredit = typeof walletCredits.$inferSelect
export type NewWalletCredit = typeof walletCredits.$inferInsert