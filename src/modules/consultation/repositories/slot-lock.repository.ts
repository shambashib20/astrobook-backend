import { eq, and, lt, sql } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { slotLocks, SLOT_LOCK_TTL_MS } from '@/core/database/schema'

export class SlotLockRepository {
  constructor(private readonly db: Database) {}

  /**
   * Ek slot ko 10 min ke liye soft-lock karo.
   * Pehle expired locks clean karo, phir try karo insert karne.
   * Agar kisi aur ne already lock rakha hai (unique constraint) — null return.
   * Agar same user pehle se lock kar chuka hai — uska ttl refresh karo.
   */
  async acquireOrRefresh(
    astrologerId: string,
    slotStart: Date,
    userId: string,
  ) {
    const expiresAt = new Date(Date.now() + SLOT_LOCK_TTL_MS)

    // Expired locks hata do (cleanup on read — no cron needed for small table)
    await this.db.delete(slotLocks).where(lt(slotLocks.expiresAt, new Date()))

    // Try insert — agar conflict toh check karo kaun ne lock rakha hai
    const [inserted] = await this.db
      .insert(slotLocks)
      .values({ astrologerId, slotStart, lockedBy: userId, expiresAt })
      .onConflictDoNothing()
      .returning()

    if (inserted) return inserted

    // Conflict — slot already locked
    const [existing] = await this.db
      .select()
      .from(slotLocks)
      .where(
        and(eq(slotLocks.astrologerId, astrologerId), eq(slotLocks.slotStart, slotStart)),
      )
      .limit(1)

    if (!existing) {
      // Race condition — expired tha aur clean ho gaya, dobara try
      const [retry] = await this.db
        .insert(slotLocks)
        .values({ astrologerId, slotStart, lockedBy: userId, expiresAt })
        .onConflictDoNothing()
        .returning()
      return retry ?? null
    }

    // Wahi user refresh karna chahta hai — extend TTL
    if (existing.lockedBy === userId) {
      const [refreshed] = await this.db
        .update(slotLocks)
        .set({ expiresAt, createdAt: sql`now()` })
        .where(eq(slotLocks.id, existing.id))
        .returning()
      return refreshed ?? null
    }

    // Kisi aur ne lock rakha hai — conflict
    return null
  }

  /**
   * Slot release karo — user page se gaya ya deselect kiya.
   * Sirf wahi user release kar sakta hai jisne lock kiya tha.
   */
  async release(astrologerId: string, slotStart: Date, userId: string) {
    const [deleted] = await this.db
      .delete(slotLocks)
      .where(
        and(
          eq(slotLocks.astrologerId, astrologerId),
          eq(slotLocks.slotStart, slotStart),
          eq(slotLocks.lockedBy, userId),
        ),
      )
      .returning()
    return deleted ?? null
  }

  /**
   * Astrologer ke liye ek date range mein active (non-expired) locks.
   * Slot generation mein use hota hai — ye slots grey (soft-locked) dikhenge.
   */
  async findActiveByAstrologerInRange(astrologerId: string, from: Date, to: Date) {
    const now = new Date()
    return this.db
      .select()
      .from(slotLocks)
      .where(
        and(
          eq(slotLocks.astrologerId, astrologerId),
          sql`${slotLocks.slotStart} >= ${from}`,
          sql`${slotLocks.slotStart} < ${to}`,
          sql`${slotLocks.expiresAt} > ${now}`,
        ),
      )
  }

  // User ke apne sare active locks — page unmount pe bulk release ke liye
  async findActiveByUser(userId: string) {
    const now = new Date()
    return this.db
      .select()
      .from(slotLocks)
      .where(
        and(eq(slotLocks.lockedBy, userId), sql`${slotLocks.expiresAt} > ${now}`),
      )
  }

  // User ke saare locks release karo (page close / logout)
  async releaseAllByUser(userId: string) {
    await this.db
      .delete(slotLocks)
      .where(eq(slotLocks.lockedBy, userId))
  }
}