import type { Database } from '@/core/database/client'
import {
  appointments,
  astrologerProfiles,
  availabilityWindows,
  cartItems,
  consultationServices,
  favorites,
  follows,
  notifications,
  otpVerifications,
  posts,
  postComments,
  postLikes,
  pushTokens,
  sessions,
  users,
} from '@/core/database/schema'
import { and, count, eq, gt, inArray, lt, or, sql } from 'drizzle-orm'
import type {
  OnboardingDto,
  SavePayoutDetailsDto,
  RequestAstrologerUpgradeDto,
  UpdateProfileDto,
} from '../schemas/user.schema'

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

  async updateOnboarding(userId: string, dto: OnboardingDto) {
    const [user] = await this.db
      .update(users)
      .set({
        name: dto.name,
        email: dto.email ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        interests: dto.interests ?? [],
        isOnboarded: true,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [user] = await this.db
      .update(users)
      .set({ ...dto, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
  }

  // ── Astrologer application (verification flow) ─────────────────────────────
  // Yahan role/isAstrologer FLIP NAHI hota — sirf ek pending application
  // (astrologerProfiles row) banti/update hoti hai. Actual role change sirf
  // admin approve karne pe hota hai (see admin module's updateVerification).

  async findAstrologerApplication(userId: string) {
    const [profile] = await this.db
      .select()
      .from(astrologerProfiles)
      .where(eq(astrologerProfiles.userId, userId))
      .limit(1)
    return profile ?? null
  }

  async submitAstrologerApplication(userId: string, dto: RequestAstrologerUpgradeDto) {
    const [profile] = await this.db
      .insert(astrologerProfiles)
      .values({
        userId,
        bio: dto.bio,
        experience: dto.experience,
        languages: dto.languages,
        specializations: dto.specializations,
        videoUrl: dto.videoUrl,
        document1Url: dto.document1Url,
        document2Url: dto.document2Url,
        verificationStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: astrologerProfiles.userId,
        set: {
          bio: dto.bio,
          experience: dto.experience,
          languages: dto.languages,
          specializations: dto.specializations,
          videoUrl: dto.videoUrl,
          document1Url: dto.document1Url,
          document2Url: dto.document2Url,
          verificationStatus: 'pending',
          rejectionReason: null,
          verifiedAt: null,
          verifiedBy: null,
          updatedAt: sql`now()`,
        },
      })
      .returning()
    return profile ?? null
  }

  // ── Payout details (manual payouts, no Razorpay Route) ─────────────────────
  // Upserts so an astrologer without an astrologer_profiles row yet still
  // gets one (bare 'pending') rather than failing.
  async savePayoutDetails(userId: string, dto: SavePayoutDetailsDto) {
    const data = {
      payoutMethod: dto.bank ? 'bank' : 'upi',
      payoutDetails: dto,
      payoutDetailsUpdatedAt: sql`now()`,
    }
    const [profile] = await this.db
      .insert(astrologerProfiles)
      .values({ userId, verificationStatus: 'pending', ...data })
      .onConflictDoUpdate({
        target: astrologerProfiles.userId,
        set: { ...data, updatedAt: sql`now()` },
      })
      .returning()
    return profile!
  }

  // ── Phone verification (Google-login users, during onboarding) ─────────────
  // Reuses the same otp_verifications table as /auth/send-otp — logic mirrors
  // auth module's UserRepository OTP methods (see src/modules/auth), just
  // scoped under this module since it's driven by an authenticated userId
  // rather than an anonymous login attempt.

  async countRecentPhoneOtpRequests(phone: string): Promise<number> {
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

  async createPhoneOtp(phone: string, otpHash: string, expiresAt: Date) {
    // Housekeeping only — findLatestPhoneOtp already filters expiresAt > now(),
    // so don't make the caller wait on this.
    this.db
      .delete(otpVerifications)
      .where(and(
        eq(otpVerifications.phone, phone),
        lt(otpVerifications.expiresAt, new Date())
      ))
      .catch((err) => console.error('Phone OTP cleanup failed (non-fatal):', err))

    const [otp] = await this.db
      .insert(otpVerifications)
      .values({ phone, otpHash, expiresAt })
      .returning()
    return otp!
  }

  async findLatestPhoneOtp(phone: string) {
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

  async incrementPhoneOtpAttempts(id: string) {
    await this.db
      .update(otpVerifications)
      .set({ attempts: sql`${otpVerifications.attempts} + 1` })
      .where(eq(otpVerifications.id, id))
  }

  async deletePhoneOtp(id: string) {
    await this.db.delete(otpVerifications).where(eq(otpVerifications.id, id))
  }

  async updatePhone(userId: string, phone: string) {
    const [user] = await this.db
      .update(users)
      .set({ phone, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
  }

  // ── Duplicate phone account handling ───────────────────────────────────────

  /**
   * Kya yeh account ek "khaali shell" hai jise bina data khoye hata sakte hain?
   * Sirf phone-login se bana account (koi email/google nahi, plain user) jispe
   * koi bhi activity nahi hai. Aisa account tab banta hai jab koi Google login
   * na chalne pe OTP se login karke (ya baad mein Google se) do account bana
   * leta hai. Kuch bhi activity ho to False — tab manually dekhna padega.
   */
  async isDisposablePhoneShell(user: {
    id: string
    email: string | null
    googleId: string | null
    role: string
    isAstrologer: boolean
  }) {
    if (user.email || user.googleId || user.role !== 'user' || user.isAstrologer) return false

    const id = user.id
    const counts = await Promise.all([
      this.db.select({ n: count() }).from(appointments)
        .where(or(eq(appointments.userId, id), eq(appointments.astrologerId, id))),
      this.db.select({ n: count() }).from(cartItems).where(eq(cartItems.userId, id)),
      this.db.select({ n: count() }).from(follows)
        .where(or(eq(follows.followerId, id), eq(follows.followingId, id))),
      this.db.select({ n: count() }).from(postLikes).where(eq(postLikes.userId, id)),
      this.db.select({ n: count() }).from(postComments).where(eq(postComments.userId, id)),
      this.db.select({ n: count() }).from(favorites).where(eq(favorites.userId, id)),
      this.db.select({ n: count() }).from(astrologerProfiles).where(eq(astrologerProfiles.userId, id)),
    ])
    return counts.every((rows) => (rows[0]?.n ?? 0) === 0)
  }

  /**
   * Shell account (oldOwner) delete karke number asli account (newOwner) ko
   * dete hain — ek transaction mein, warna unique(phone) beech mein toot jaata.
   * oldOwner ke sessions/push tokens/notifications FK cascade se saaf ho jaate hain.
   */
  async moveNumberFromShell(oldOwnerId: string, newOwnerId: string, phone: string) {
    return this.db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, oldOwnerId))
      const [user] = await tx
        .update(users)
        .set({ phone, updatedAt: sql`now()` })
        .where(eq(users.id, newOwnerId))
        .returning()
      return user ?? null
    })
  }

  // ── Account deletion ───────────────────────────────────────────────────────

  /**
   * Confirmed / ongoing appointments jahan yeh user student ya astrologer
   * dono roles mein se kisi mein bhi involved hai. Inke hote hue account
   * delete nahi hona chahiye — doosri party ka paid session ruk jaayega.
   */
  async countActiveAppointments(userId: string) {
    const [row] = await this.db
      .select({ value: count() })
      .from(appointments)
      .where(
        and(
          or(eq(appointments.userId, userId), eq(appointments.astrologerId, userId)),
          inArray(appointments.status, ['confirmed', 'ongoing']),
        ),
      )
    return row?.value ?? 0
  }

  /**
   * Soft-delete (anonymize): users row ko HARD delete nahi karte, kyunki
   * appointments/payments ki FKs ON DELETE CASCADE hain — hard delete se
   * doosri party (astrologer ya user) ke booking aur payment records bhi
   * ud jaate, jo accounting ke liye rakhne zaroori hain.
   *
   * Yahan sirf personal data hata ke row ko ek khaali "Deleted User" bana
   * dete hain. phone/email/googleId null hone se purane credentials se
   * login ab isi row pe nahi jaayega — wahi phone se naya signup fresh
   * account banayega.
   */
  async anonymizeAccount(userId: string) {
    await this.db.transaction(async (tx) => {
      // Unpaid (pending) bookings cancel — warna baad mein aaya payment
      // webhook ek deleted account ke naam pe booking confirm kar sakta hai.
      await tx
        .update(appointments)
        .set({ status: 'cancelled' })
        .where(
          and(
            or(eq(appointments.userId, userId), eq(appointments.astrologerId, userId)),
            eq(appointments.status, 'pending'),
          ),
        )

      // Login / device data
      await tx.delete(sessions).where(eq(sessions.userId, userId))
      await tx.delete(pushTokens).where(eq(pushTokens.userId, userId))

      // Social + cart data
      await tx.delete(cartItems).where(or(eq(cartItems.userId, userId), eq(cartItems.astrologerId, userId)))
      await tx.delete(favorites).where(eq(favorites.userId, userId))
      await tx.delete(follows).where(or(eq(follows.followerId, userId), eq(follows.followingId, userId)))
      await tx
        .delete(notifications)
        .where(or(eq(notifications.userId, userId), eq(notifications.actorId, userId)))
      await tx.delete(postLikes).where(eq(postLikes.userId, userId))
      await tx.delete(postComments).where(eq(postComments.userId, userId))
      await tx.delete(posts).where(eq(posts.astrologerId, userId))

      // Astrologer side — listing se hatao, KYC documents / media hatao.
      // Razorpay account ids aur rating jaan-boojh ke rakhe hain (payout
      // aur audit ke liye).
      await tx
        .update(consultationServices)
        .set({ isActive: false })
        .where(eq(consultationServices.astrologerId, userId))
      await tx
        .update(availabilityWindows)
        .set({ isActive: false })
        .where(eq(availabilityWindows.astrologerId, userId))
      await tx
        .update(astrologerProfiles)
        .set({
          isActive: false,
          isOnline: false,
          bio: null,
          photoUrl: null,
          bannerUrl: null,
          videoUrl: null,
          document1Url: null,
          document2Url: null,
          updatedAt: sql`now()`,
        })
        .where(eq(astrologerProfiles.userId, userId))

      await tx
        .update(users)
        .set({
          name: 'Deleted User',
          phone: null,
          email: null,
          googleId: null,
          dateOfBirth: null,
          interests: [],
          avatarUrl: null,
          bio: null,
          passwordHash: null,
          role: 'user',
          isAstrologer: false,
          isBanned: true,
          banReason: 'Account deleted by user',
          meta: { deletedAt: new Date().toISOString() },
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, userId))
    })
  }
}
