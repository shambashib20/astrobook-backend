import type { Database } from '@/core/database/client'
import { astrologerProfiles, otpVerifications, users } from '@/core/database/schema'
import { and, count, eq, gt, lt, sql } from 'drizzle-orm'
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
}