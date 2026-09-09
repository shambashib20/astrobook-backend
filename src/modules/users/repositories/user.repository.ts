import type { Database } from '@/core/database/client'
import { astrologerProfiles, otpVerifications, users } from '@/core/database/schema'
import { and, count, eq, gt, lt, sql } from 'drizzle-orm'
import type {
  OnboardingDto,
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

  // ── Cashfree Easy Split vendor onboarding ───────────────────────────────────

  // Cashfree's vendor_id is caller-chosen and deterministic per astrologer
  // (see generateCashfreeVendorId), so — unlike Razorpay's reference_id —
  // there's no need to mint anything before the vendor call goes out. If the
  // user hasn't submitted an astrologer application yet, create a bare
  // pending row here rather than failing the onboarding step on that.
  async ensureAstrologerProfile(userId: string) {
    const [profile] = await this.db
      .insert(astrologerProfiles)
      .values({ userId, verificationStatus: 'pending' })
      .onConflictDoUpdate({
        target: astrologerProfiles.userId,
        set: { updatedAt: sql`now()` },
      })
      .returning()
    return profile!
  }

  async updateEmail(userId: string, email: string) {
    const [user] = await this.db
      .update(users)
      .set({ email, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
  }

  // ── Razorpay Route persistence (commented out during the Cashfree
  // migration — kept, not deleted, for a quick rollback) ──
  // async saveRazorpayAccount(userId: string, data: {...}) { ... }
  // async saveRazorpayProduct(userId: string, data: {...}) { ... }
  // async saveRazorpayStakeholder(userId: string, data: {...}) { ... }
  // async saveRazorpayDocuments(userId: string, uploadedByType: Record<string, unknown>) { ... }

  // Single save — Cashfree's vendor create/update call returns everything
  // (bank/UPI + KYC + status) in one response, so there's only one method
  // here instead of Razorpay Route's four staged saves.
  async saveCashfreeVendor(
    userId: string,
    data: {
      cashfreeVendorId: string
      cashfreeVendorStatus: string
      cashfreeVendorResponse: unknown
    },
  ) {
    const [profile] = await this.db
      .insert(astrologerProfiles)
      .values({
        userId,
        verificationStatus: 'pending',
        ...data,
        cashfreeVendorCreatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: astrologerProfiles.userId,
        set: {
          ...data,
          updatedAt: sql`now()`,
        },
      })
      .returning()
    return profile ?? null
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