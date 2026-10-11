import { eq, and, sql, inArray } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { recurringAvailability } from '@/core/database/schema'
import type { CreateRecurringAvailabilityDto } from '../schemas/consultation.schema'

export class RecurringAvailabilityRepository {
  constructor(private readonly db: Database) {}

  /**
   * Insert or reactivate a recurring slot. Same (astrologer, dayOfWeek,
   * startTime, endTime) pe conflict → reactivate + timezone update.
   */
  async upsert(astrologerId: string, dto: CreateRecurringAvailabilityDto) {
    const [row] = await this.db
      .insert(recurringAvailability)
      .values({
        astrologerId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        timezone: dto.timezone ?? 'Asia/Kolkata',
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [
          recurringAvailability.astrologerId,
          recurringAvailability.dayOfWeek,
          recurringAvailability.startTime,
          recurringAvailability.endTime,
        ],
        set: {
          timezone: sql`excluded.timezone`,
          isActive: true,
          updatedAt: sql`now()`,
        },
      })
      .returning()
    return row!
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(recurringAvailability)
      .where(eq(recurringAvailability.id, id))
      .limit(1)
    return row ?? null
  }

  // Astrologer ke saare active recurring patterns — dashboard mein dikhane ke liye
  async findByAstrologer(astrologerId: string) {
    return this.db
      .select()
      .from(recurringAvailability)
      .where(
        and(
          eq(recurringAvailability.astrologerId, astrologerId),
          eq(recurringAvailability.isActive, true),
        ),
      )
      .orderBy(recurringAvailability.dayOfWeek, recurringAvailability.startTime)
  }

  // Slot generation ke liye — ek specific date ka dayOfWeek fetch karke iske
  // matching recurring rows milte hain. dayOfWeeks JS-style array.
  async findByAstrologerAndDays(astrologerId: string, dayOfWeeks: number[]) {
    if (dayOfWeeks.length === 0) return []
    return this.db
      .select()
      .from(recurringAvailability)
      .where(
        and(
          eq(recurringAvailability.astrologerId, astrologerId),
          eq(recurringAvailability.isActive, true),
          inArray(recurringAvailability.dayOfWeek, dayOfWeeks),
        ),
      )
      .orderBy(recurringAvailability.startTime)
  }

  // Soft delete — isActive=false
  async delete(id: string, astrologerId: string) {
    const [row] = await this.db
      .update(recurringAvailability)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(recurringAvailability.id, id),
          eq(recurringAvailability.astrologerId, astrologerId),
        ),
      )
      .returning()
    return row ?? null
  }
}