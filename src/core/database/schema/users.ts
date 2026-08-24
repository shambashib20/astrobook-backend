import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['user', 'astrologer', 'admin'])
export const verificationStatusEnum = pgEnum('verification_status', [
  'pending',
  'approved',
  'rejected',
])

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
  id:           uuid('id').primaryKey().defaultRandom(),
  phone:        varchar('phone', { length: 20 }).unique(),       // primary identity — OTP se
  email:        varchar('email', { length: 255 }).unique(),      // optional
  name:         varchar('name', { length: 255 }),                // onboarding mein aayega
  dateOfBirth:  date('date_of_birth'),
  role:         userRoleEnum('role').notNull().default('user'),
  interests:    text('interests').array(),
  isOnboarded:  boolean('is_onboarded').notNull().default(false),
  isAstrologer: boolean('is_astrologer').notNull().default(false),
  googleId:     varchar('google_id', { length: 128 }).unique(),  // Google login ke liye
  avatarUrl:    text('avatar_url'),
  bio:          text('bio'),                                     // regular user ka apna bio — astrologerProfiles.bio se alag
  passwordHash: varchar('password_hash', { length: 255 }),        // sirf admin accounts use karte hain (email+password login)
  isBanned:     boolean('is_banned').notNull().default(false),    // admin panel se ban/unban
  banReason:    text('ban_reason'),
  meta:         jsonb('meta').$type<any>(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // GET /astrologers filters `WHERE is_astrologer = true` — a boolean
    // column is a bad index candidate on its own (low cardinality), but a
    // *partial* index (only the true rows) stays small and fast even as
    // the overall users table grows into the millions.
    isAstrologerIdx: index('users_is_astrologer_idx')
      .on(table.isAstrologer)
      .where(sql`${table.isAstrologer} = true`),
  }),
)

// ─── Astrologer Profiles ──────────────────────────────────────────────────────

export const astrologerProfiles = pgTable('astrologer_profiles', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id')
                      .notNull()
                      .unique()
                      .references(() => users.id, { onDelete: 'cascade' }),

  // Basic info
  bio:              text('bio'),
  experience:       smallint('experience').default(0),           // years
  languages:        text('languages').array(),                   // ['Hindi', 'English', 'Bengali']
  specializations:  text('specializations').array(),             // ['Vedic', 'Tarot', 'Numerology']

  // Media
  photoUrl:         text('photo_url'),
  bannerUrl:        text('banner_url'),

  // Rating (updated after each review)
  rating:           numeric('rating', { precision: 3, scale: 2 }).default('0.00'),
  totalReviews:     integer('total_reviews').default(0),

  // Status
  isVerified:       boolean('is_verified').notNull().default(false),  // admin approve karega — verificationStatus se derive/sync hota hai
  isOnline:         boolean('is_online').notNull().default(false),
  isActive:         boolean('is_active').notNull().default(true),

  // Verification (admin panel) — do documents + status
  verificationStatus: verificationStatusEnum('verification_status').notNull().default('pending'),
  videoUrl:         text('video_url'),                              // 1-min intro video jab application submit hoti hai
  document1Url:     text('document_1_url'),                        // e.g. ID proof
  document2Url:     text('document_2_url'),                        // e.g. certificate
  rejectionReason:  text('rejection_reason'),
  verifiedAt:       timestamp('verified_at', { withTimezone: true }),
  verifiedBy:       uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),

  // Pricing (default — services mein override hoga)
  basePrice:        numeric('base_price', { precision: 10, scale: 2 }),

  // Razorpay Route linked account — astrologer ko payout lene ke liye
  // Razorpay ke saath onboard hona padta hai. Yeh sirf account creation
  // ka step hai (POST /v2/accounts) — KYC/bank-details wagera baad ke
  // steps mein aayenge, tab tak status 'created' hi rahega.
  razorpayAccountId:       varchar('razorpay_account_id', { length: 64 }).unique(),
  razorpayAccountStatus:   varchar('razorpay_account_status', { length: 32 }),
  razorpayReferenceId:     varchar('razorpay_reference_id', { length: 128 }),
  razorpayAccountResponse: jsonb('razorpay_account_response').$type<any>(),
  razorpayAccountCreatedAt: timestamp('razorpay_account_created_at', { withTimezone: true }),

  meta:             jsonb('meta').$type<any>(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── OTP Verifications ────────────────────────────────────────────────────────

export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    phone:     varchar('phone', { length: 20 }).notNull(),
    otpHash:   varchar('otp_hash', { length: 255 }).notNull(),    // bcrypt hash
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts:  integer('attempts').notNull().default(0),           // max 3 wrong tries
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Every OTP endpoint (send/verify/rate-limit-count) filters by phone.
    // No unique constraint on this column (unlike users.phone), so it was
    // an unindexed full table scan on every single auth request.
    phoneIdx: index('otp_verifications_phone_idx').on(table.phone),
    phoneCreatedAtIdx: index('otp_verifications_phone_created_at_idx').on(
      table.phone,
      table.createdAt,
    ),
  }),
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type User                 = typeof users.$inferSelect
export type NewUser              = typeof users.$inferInsert
export type AstrologerProfile    = typeof astrologerProfiles.$inferSelect
export type NewAstrologerProfile = typeof astrologerProfiles.$inferInsert
export type OtpVerification      = typeof otpVerifications.$inferSelect
export type NewOtpVerification   = typeof otpVerifications.$inferInsert