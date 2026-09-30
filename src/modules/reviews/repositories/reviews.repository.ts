import type { Database } from '@/core/database/client'
import { appointments, astrologerProfiles, reviews, users } from '@/core/database/schema'
import { and, desc, eq, sql } from 'drizzle-orm'

export class ReviewsRepository {
  constructor(private readonly db: Database) {}

  // Review submit/update ke liye — appointment ki ownership + status check
  async findAppointment(appointmentId: string) {
    const [row] = await this.db
      .select({
        id: appointments.id,
        userId: appointments.userId,
        astrologerId: appointments.astrologerId,
        status: appointments.status,
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1)
    return row ?? null
  }

  async findByAppointment(appointmentId: string) {
    const [row] = await this.db
      .select()
      .from(reviews)
      .where(eq(reviews.appointmentId, appointmentId))
      .limit(1)
    return row ?? null
  }

  // Review save + astrologer ka rating/total_reviews recalculate — ek hi
  // transaction mein, taaki dono kabhi out-of-sync na hon.
  async upsert(input: {
    appointmentId: string
    userId: string
    astrologerId: string
    rating: number
    comment: string | null
  }) {
    return this.db.transaction(async (tx) => {
      const [review] = await tx
        .insert(reviews)
        .values(input)
        .onConflictDoUpdate({
          target: reviews.appointmentId,
          set: { rating: input.rating, comment: input.comment, updatedAt: sql`now()` },
        })
        .returning()
      await this.recalculateRating(tx, input.astrologerId)
      return review!
    })
  }

  async deleteByAppointment(appointmentId: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(reviews)
        .where(and(eq(reviews.appointmentId, appointmentId), eq(reviews.userId, userId)))
        .returning()
      if (deleted) await this.recalculateRating(tx, deleted.astrologerId)
      return deleted ?? null
    })
  }

  // reviews table = source of truth. Ek bhi review na bache to 0 / 0.
  private async recalculateRating(
    tx: Pick<Database, 'update' | 'select'>,
    astrologerId: string,
  ) {
    const [agg] = await tx
      .select({
        avg: sql<string | null>`round(avg(${reviews.rating})::numeric, 2)`,
        total: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.astrologerId, astrologerId))

    await tx
      .update(astrologerProfiles)
      .set({
        rating: agg?.avg ?? '0.00',
        totalReviews: agg?.total ?? 0,
        updatedAt: sql`now()`,
      })
      .where(eq(astrologerProfiles.userId, astrologerId))
  }

  // Astrologer profile pe reviews (naye pehle) + reviewer ka naam/photo
  async listForAstrologer(astrologerId: string, limit: number, offset: number) {
    return this.db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        reviewerName: users.name,
        reviewerAvatarUrl: users.avatarUrl,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.astrologerId, astrologerId))
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset(offset)
  }

  // Star-wise breakdown: [{ rating: 5, count: 12 }, ...]
  async distributionForAstrologer(astrologerId: string) {
    return this.db
      .select({
        rating: reviews.rating,
        count: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.astrologerId, astrologerId))
      .groupBy(reviews.rating)
  }

  // Meri di hui reviews — my-bookings mein "Rate karo" vs "Aapki rating"
  async listByUser(userId: string) {
    return this.db
      .select({
        id: reviews.id,
        appointmentId: reviews.appointmentId,
        astrologerId: reviews.astrologerId,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
      })
      .from(reviews)
      .where(eq(reviews.userId, userId))
      .orderBy(desc(reviews.createdAt))
  }
}
