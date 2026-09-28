import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { cartItems } from '@/core/database/schema'
import type { NewCartItem } from '@/core/database/schema'

export class CartRepository {
  constructor(private readonly db: Database) {}

  async create(data: NewCartItem) {
    const [item] = await this.db.insert(cartItems).values(data).returning()
    return item!
  }

  // Same user ka same service (same astrologer ki same consultancy) cart mein
  // pehle se hai kya — addItem isse check karta hai taaki duplicate row na bane
  async findExisting(userId: string, serviceId: string) {
    const [item] = await this.db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.userId, userId), eq(cartItems.serviceId, serviceId)))
      .limit(1)
    return item ?? null
  }

  // Existing cart item ka variant (duration/price) badalna — "dobara add"
  // ya "different duration select" karne pe naya row banane ki jagah yahi
  // update hota hai. scheduledAt reset karte hain kyunki duration badalne se
  // pehle se select kiya hua slot ab wahi length ka nahi rahega.
  async updateVariant(id: string, userId: string, variantId: string | null) {
    const [item] = await this.db
      .update(cartItems)
      .set({ variantId, scheduledAt: null, updatedAt: new Date() })
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)))
      .returning()
    return item ?? null
  }

  async findMine(userId: string) {
    return this.db.select().from(cartItems).where(eq(cartItems.userId, userId))
  }

  async findByIdsForUser(ids: string[], userId: string) {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(cartItems)
      .where(and(inArray(cartItems.id, ids), eq(cartItems.userId, userId)))
  }

  async setSlot(id: string, userId: string, scheduledAt: Date) {
    const [item] = await this.db
      .update(cartItems)
      .set({ scheduledAt, updatedAt: new Date() })
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)))
      .returning()
    return item ?? null
  }

  async delete(id: string, userId: string) {
    await this.db.delete(cartItems).where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)))
  }

  async deleteMany(ids: string[], userId: string) {
    if (ids.length === 0) return
    await this.db
      .delete(cartItems)
      .where(and(inArray(cartItems.id, ids), eq(cartItems.userId, userId)))
  }
}