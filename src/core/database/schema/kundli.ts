import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── User Kundlis ─────────────────────────────────────────────────────────────
// Har user ka ek Kundli record — Kundlit API se generate hota hai.
// Birth details users table mein bhi hain, lekin yahan snapshot rakha hai
// taaki agar user baad mein details change kare, purana Kundli intact rahe.

export const userKundlis = pgTable(
  'user_kundlis',
  {
    id:     uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
              .notNull()
              .unique()                                      // ek user → ek kundli
              .references(() => users.id, { onDelete: 'cascade' }),

    // ── Core chart identity ────────────────────────────────────────────────
    // Ye teeno cheezein har user apni profile mein dikhayega / share karega
    lagna:           varchar('lagna', { length: 50 }),       // e.g. "Mesh"
    lagnaLord:       varchar('lagna_lord', { length: 50 }),  // e.g. "Mangal"
    lagnaDegree:     numeric('lagna_degree', { precision: 6, scale: 3 }),
    rashi:           varchar('rashi', { length: 50 }),        // Moon sign e.g. "Vrishabh"
    rashiLord:       varchar('rashi_lord', { length: 50 }),
    sunSign:         varchar('sun_sign', { length: 50 }),     // Western crossover
    nakshatra:       varchar('nakshatra', { length: 50 }),    // Birth star e.g. "Rohini"
    nakshatraPada:   smallint('nakshatra_pada'),               // 1–4

    // ── Dasha (users baar baar check karte hain — "mera period kab badlega?")
    currentMahadasha:    varchar('current_mahadasha', { length: 50 }),    // e.g. "Shani"
    currentAntardasha:   varchar('current_antardasha', { length: 50 }),   // e.g. "Rahu"
    currentPratyantar:   varchar('current_pratyantar', { length: 50 }),
    mahadashaEndDate:    date('mahadasha_end_date'),   // "Shani Mahadasha kab khatam?"
    antardashaEndDate:   date('antardasha_end_date'),  // sub-period end

    // ── Doshas (concern = users consult karte hain — sabse bada hook)
    // Manglik
    isManglik:     boolean('is_manglik').notNull().default(false),
    manglikType:   varchar('manglik_type', { length: 20 }),  // 'full' | 'partial' | null

    // Kaal Sarp
    hasKaalSarp:   boolean('has_kaal_sarp').notNull().default(false),
    kaalSarpType:  varchar('kaal_sarp_type', { length: 50 }), // 'Anant' | 'Kulik' etc

    // Sade Sati (Shani 7.5 year period)
    sadeSatiActive:   boolean('sade_sati_active').notNull().default(false),
    sadeSatiEndDate:  date('sade_sati_end_date'),  // "Meri Sade Sati kab khatam?"
    sadeSatiPhase:    varchar('sade_sati_phase', { length: 20 }), // 'rising' | 'peak' | 'setting'

    // ── Detailed data (Kundli screen ke liye) ─────────────────────────────
    planetsData:    jsonb('planets_data').$type<Record<string, any>>(),    // 9 grahas positions
    housesData:     jsonb('houses_data').$type<Record<string, any>>(),     // 12 houses
    dashaTimeline:  jsonb('dasha_timeline').$type<any[]>(),                // lifetime dasha sequence
    fullKundliData: jsonb('full_kundli_data').$type<Record<string, any>>(), // raw Kundlit API response

    // ── Sharing ────────────────────────────────────────────────────────────
    isPublic:    boolean('is_public').notNull().default(false),
    // Random token — /kundli/share/:token se public access
    // user_id expose nahi hota
    shareToken:  varchar('share_token', { length: 64 }).unique()
                   .default(sql`gen_random_uuid()::text`),

    // ── Birth details snapshot (at time of generation) ────────────────────
    // Users table mein bhi hain — lekin yahan isliye ki agar user details
    // change kare toh regenerate karna obvious ho (mismatch detect hoga)
    birthDate:   date('birth_date'),
    birthTime:   time('birth_time'),
    birthPlace:  varchar('birth_place', { length: 255 }),
    birthLat:    numeric('birth_lat', { precision: 9, scale: 6 }),
    birthLng:    numeric('birth_lng', { precision: 9, scale: 6 }),

    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // userId unique already — yeh extra index needed nahi, but kept for
    // clarity; ORM uses unique index for FK lookups automatically
    userIdIdx: index('user_kundlis_user_id_idx').on(table.userId),

    // "Sade Sati active users" push notification cron ke liye
    sadeSatiActiveIdx: index('user_kundlis_sade_sati_active_idx')
      .on(table.sadeSatiActive)
      .where(sql`${table.sadeSatiActive} = true`),

    // "Dasha ending soon" reminder cron ke liye (next 30 days)
    mahadashaEndIdx: index('user_kundlis_mahadasha_end_date_idx').on(table.mahadashaEndDate),
  }),
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserKundli    = typeof userKundlis.$inferSelect
export type NewUserKundli = typeof userKundlis.$inferInsert
