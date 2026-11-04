import { and, eq, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import { userKundlis, type NewUserKundli, type UserKundli } from '../../../core/database/schema'

export class KundliRepository {
  constructor(private readonly db: NeonDatabase<any>) {}

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  async findByUserId(userId: string): Promise<UserKundli | null> {
    const rows = await this.db
      .select()
      .from(userKundlis)
      .where(eq(userKundlis.userId, userId))
      .limit(1)
    return rows[0] ?? null
  }

  async findByShareToken(shareToken: string): Promise<UserKundli | null> {
    const rows = await this.db
      .select()
      .from(userKundlis)
      .where(
        and(
          eq(userKundlis.shareToken, shareToken),
          eq(userKundlis.isPublic, true),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  }

  // ─── Upsert ─────────────────────────────────────────────────────────────────

  async upsert(data: NewUserKundli): Promise<UserKundli> {
    const rows = await this.db
      .insert(userKundlis)
      .values(data)
      .onConflictDoUpdate({
        target: userKundlis.userId,
        set: {
          // Core identity
          lagna:            data.lagna,
          lagnaLord:        data.lagnaLord,
          lagnaDegree:      data.lagnaDegree,
          rashi:            data.rashi,
          rashiLord:        data.rashiLord,
          sunSign:          data.sunSign,
          nakshatra:        data.nakshatra,
          nakshatraPada:    data.nakshatraPada,
          // Dasha
          currentMahadasha:  data.currentMahadasha,
          currentAntardasha: data.currentAntardasha,
          currentPratyantar: data.currentPratyantar,
          mahadashaEndDate:  data.mahadashaEndDate,
          antardashaEndDate: data.antardashaEndDate,
          // Doshas
          isManglik:      data.isManglik,
          manglikType:    data.manglikType,
          hasKaalSarp:    data.hasKaalSarp,
          kaalSarpType:   data.kaalSarpType,
          sadeSatiActive: data.sadeSatiActive,
          sadeSatiEndDate:data.sadeSatiEndDate,
          sadeSatiPhase:  data.sadeSatiPhase,
          // Json
          planetsData:    data.planetsData,
          housesData:     data.housesData,
          dashaTimeline:  data.dashaTimeline,
          fullKundliData: data.fullKundliData,
          // Birth snapshot
          birthDate:  data.birthDate,
          birthTime:  data.birthTime,
          birthPlace: data.birthPlace,
          birthLat:   data.birthLat,
          birthLng:   data.birthLng,
          // Timestamps
          generatedAt: data.generatedAt,
          updatedAt:   sql`now()`,
        },
      })
      .returning()
    return rows[0]!
  }

  // ─── Visibility ─────────────────────────────────────────────────────────────

  async updateVisibility(userId: string, isPublic: boolean): Promise<UserKundli | null> {
    const rows = await this.db
      .update(userKundlis)
      .set({ isPublic, updatedAt: sql`now()` })
      .where(eq(userKundlis.userId, userId))
      .returning()
    return rows[0] ?? null
  }

  // ─── Admin / Cron helpers ────────────────────────────────────────────────────

  /** Users jin ka Sade Sati active hai — push notification ke liye */
  async findActiveSadeSatiUsers(): Promise<Pick<UserKundli, 'userId' | 'sadeSatiEndDate' | 'sadeSatiPhase'>[]> {
    return this.db
      .select({
        userId:          userKundlis.userId,
        sadeSatiEndDate: userKundlis.sadeSatiEndDate,
        sadeSatiPhase:   userKundlis.sadeSatiPhase,
      })
      .from(userKundlis)
      .where(eq(userKundlis.sadeSatiActive, true))
  }

  /** Users jin ka Mahadasha 90 din mein khatam ho raha hai */
  async findUpcomingMahadashaChanges(): Promise<Pick<UserKundli, 'userId' | 'currentMahadasha' | 'mahadashaEndDate'>[]> {
    return this.db
      .select({
        userId:           userKundlis.userId,
        currentMahadasha: userKundlis.currentMahadasha,
        mahadashaEndDate: userKundlis.mahadashaEndDate,
      })
      .from(userKundlis)
      .where(
        sql`${userKundlis.mahadashaEndDate} <= now() + interval '90 days'
          AND ${userKundlis.mahadashaEndDate} >= now()`,
      )
  }
}
