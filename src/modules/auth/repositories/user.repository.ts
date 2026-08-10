import type { Database } from '@/core/database/client'
import { otpVerifications, users } from '@/core/database/schema'
import { and, count, eq, gt, lt, sql } from 'drizzle-orm'

export class UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return user ?? null
  }

  async findByPhone(phone: string) {
    const [user] = await this.db.select().from(users).where(eq(users.phone, phone)).limit(1)
    return user ?? null
  }

  async findByEmail(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1)
    return user ?? null
  }

  async findByGoogleId(googleId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.googleId, googleId)).limit(1)
    return user ?? null
  }

  async createUser(phone: string) {
    const [user] = await this.db
      .insert(users)
      .values({ phone, role: 'user', isOnboarded: false })
      .returning()
    return user!
  }

  async createGoogleUser(data: {
    googleId: string
    email?: string
    name?: string
    avatarUrl?: string
  }) {
    const [user] = await this.db
      .insert(users)
      .values({
        googleId:   data.googleId,
        email:      data.email ?? null,
        name:       data.name ?? null,
        avatarUrl:  data.avatarUrl ?? null,
        role:       'user',
        isOnboarded: false,
      })
      .returning()
    return user!
  }

  async linkGoogleId(userId: string, googleId: string) {
    await this.db
      .update(users)
      .set({ googleId, updatedAt: new Date() })
      .where(eq(users.id, userId))
  }

  // ─── OTP Methods ────────────────────────────────────────────────────────────

  async createOtp(phone: string, otpHash: string, expiresAt: Date) {
    // Purane expired OTPs clean karo — this is pure housekeeping
    // (findLatestOtp already filters expiresAt > now(), so a stale row
    // sitting around doesn't affect correctness). Every DB round trip on
    // a remote Postgres (Neon) costs real network latency in series, so
    // don't make the client wait on this — fire it and move on.
    this.db
      .delete(otpVerifications)
      .where(and(
        eq(otpVerifications.phone, phone),
        lt(otpVerifications.expiresAt, new Date())
      ))
      .catch((err) => console.error('OTP cleanup failed (non-fatal):', err))

    const [otp] = await this.db
      .insert(otpVerifications)
      .values({ phone, otpHash, expiresAt })
      .returning()
    return otp!
  }

  async findLatestOtp(phone: string) {
    const [otp] = await this.db
      .select()
      .from(otpVerifications)
      .where(and(
        eq(otpVerifications.phone, phone),
        gt(otpVerifications.expiresAt, new Date())
      ))
      .orderBy(sql`${otpVerifications.createdAt} DESC`)
      .limit(1)
    return otp ?? null
  }

  async incrementOtpAttempts(id: string) {
    await this.db
      .update(otpVerifications)
      .set({ attempts: sql`${otpVerifications.attempts} + 1` })
      .where(eq(otpVerifications.id, id))
  }

  async deleteOtp(id: string) {
    await this.db.delete(otpVerifications).where(eq(otpVerifications.id, id))
  }

  async countRecentOtpRequests(phone: string): Promise<number> {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    const [result] = await this.db
      .select({ count: count() })
      .from(otpVerifications)
      .where(and(
        eq(otpVerifications.phone, phone),
        gt(otpVerifications.createdAt, tenMinAgo)
      ))
    return result?.count ?? 0
  }
}
