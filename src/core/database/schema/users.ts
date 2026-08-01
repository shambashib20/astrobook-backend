import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  date,
  text,
  jsonb,
  integer,
  numeric,
  smallint,
} from 'drizzle-orm/pg-core'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['user', 'astrologer', 'admin'])

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
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
  meta:         jsonb('meta').$type<any>(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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
  isVerified:       boolean('is_verified').notNull().default(false),  // admin approve karega
  isOnline:         boolean('is_online').notNull().default(false),
  isActive:         boolean('is_active').notNull().default(true),

  // Pricing (default — services mein override hoga)
  basePrice:        numeric('base_price', { precision: 10, scale: 2 }),

  meta:             jsonb('meta').$type<any>(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── OTP Verifications ────────────────────────────────────────────────────────

export const otpVerifications = pgTable('otp_verifications', {
  id:        uuid('id').primaryKey().defaultRandom(),
  phone:     varchar('phone', { length: 20 }).notNull(),
  otpHash:   varchar('otp_hash', { length: 255 }).notNull(),    // bcrypt hash
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts:  integer('attempts').notNull().default(0),           // max 3 wrong tries
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type User                 = typeof users.$inferSelect
export type NewUser              = typeof users.$inferInsert
export type AstrologerProfile    = typeof astrologerProfiles.$inferSelect
export type NewAstrologerProfile = typeof astrologerProfiles.$inferInsert
export type OtpVerification      = typeof otpVerifications.$inferSelect
export type NewOtpVerification   = typeof otpVerifications.$inferInsert