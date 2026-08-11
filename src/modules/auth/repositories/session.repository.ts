import { env } from '@/config/env'
import type { Database } from '@/core/database/client'
import { sessions } from '@/core/database/schema'
import type { NewSession } from '@/core/database/schema'
import { and, desc, eq } from 'drizzle-orm'

export class SessionRepository {
  constructor(private readonly db: Database) {}

  async create(data: NewSession) {
    const [session] = await this.db.insert(sessions).values(data).returning()
    return session!
  }

  async findByRefreshToken(refreshToken: string) {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshToken, refreshToken))
      .limit(1)
    return session ?? null
  }

  async findByUserId(userId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
  }

  async deleteById(id: string) {
    await this.db.delete(sessions).where(eq(sessions.id, id))
  }

  async deleteByRefreshToken(refreshToken: string) {
    await this.db.delete(sessions).where(eq(sessions.refreshToken, refreshToken))
  }

  async deleteByUserId(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId))
  }

  /**
   * Enforce max sessions per user.
   * If user has >= MAX_SESSIONS_PER_USER, delete the oldest one.
   *
   * Previously fetched every column (including two jsonb blobs) of every
   * session just to count them and find the oldest. Selecting only `id`
   * (backed by the userId+createdAt index) cuts the row size and lets
   * this be an index-only scan instead of a full-row heap fetch.
   */
  async enforceSessionLimit(userId: string): Promise<void> {
    const rows = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))

    if (rows.length >= env.MAX_SESSIONS_PER_USER) {
      const oldestSession = rows[rows.length - 1]
      if (oldestSession) {
        await this.deleteById(oldestSession.id)
      }
    }
  }
}
