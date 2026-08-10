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
  pgEnum,
  unique,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── Enums ───────────────────────────────────────────────────────────────────

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'pending', // payment nahi hua abhi
  'confirmed', // payment done, time nahi aaya
  'ongoing', // session chal raha hai
  'completed', // session khatam
  'cancelled', // cancel hua
])

export const bundleStatusEnum = pgEnum('bundle_status', [
  'in_progress', // koi child session ongoing hai
  'paused', // current complete, future child pending
  'completed', // sab khatam
])

export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'success', 'failed'])

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
    razorpayOrderId: varchar('razorpay_order_id', { length: 255 }),
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 255 }),
    razorpaySignature: varchar('razorpay_signature', { length: 512 }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appointmentIdIdx: index('payments_appointment_id_idx').on(table.appointmentId),
    // Razorpay webhook handler looks payments up by order id — every
    // webhook delivery was a full table scan without this.
    razorpayOrderIdIdx: index('payments_razorpay_order_id_idx').on(table.razorpayOrderId),
  }),
)

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

export type ServiceRequest = typeof serviceRequests.$inferSelect
export type NewServiceRequest = typeof serviceRequests.$inferInsert