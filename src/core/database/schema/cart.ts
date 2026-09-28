import { pgTable, uuid, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { users } from './users'
import { consultationServices, consultationServiceVariants } from './consultation'

// ─── Cart Items ─────────────────────────────────────────────────────────────
// Ek user ke cart mein multiple alag services/astrologers ho sakte hain.
// `scheduledAt` null rehta hai jab tak user cart mein hi slot pick na kare —
// checkout sirf un items ke liye ho sakta hai jinka slot set ho.

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => consultationServices.id, { onDelete: 'cascade' }),
    // Kaunsa duration/price variant select kiya tha (nullable — purane cart
    // items ke liye, aur legacy support ke liye jab variant delete ho jaye)
    variantId: uuid('variant_id').references(() => consultationServiceVariants.id, {
      onDelete: 'set null',
    }),
    // Slot cart mein hi baad mein set hota hai (ek dedicated slot-picker screen se)
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // "Get my cart" is the hot path here — filters by userId on every load.
    userIdIdx: index('cart_items_user_id_idx').on(table.userId),
    // Ek user same service (same astrologer ki same consultancy) ko cart mein
    // ek hi baar rakh sakta hai — chahe kitni baar "Add to Cart" kare ya
    // duration/price badal ke firse add kare, row wahi ek rehti hai, sirf
    // uska variantId update hota hai (PM decision: alag-alag price/duration
    // wale multiple entries same consultancy ke liye allowed nahi hain).
    // App-level check (cart.service.ts) already isko enforce karta hai —
    // yeh DB-level safety net hai taaki koi race condition ya future bug
    // dobara duplicate rows na bana sake.
    uniqueUserService: unique('cart_items_user_service_unique').on(
      table.userId,
      table.serviceId,
    ),
  }),
)

export type CartItem = typeof cartItems.$inferSelect
export type NewCartItem = typeof cartItems.$inferInsert