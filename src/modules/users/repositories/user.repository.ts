import type { Database } from '@/core/database/client'
import { astrologerProfiles, users } from '@/core/database/schema'
import { eq, sql } from 'drizzle-orm'
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

  // ── Razorpay Route account onboarding ───────────────────────────────────────

  // Razorpay's reference_id needs a stable id that already exists in our DB
  // *before* the account call goes out — the astrologerProfiles row's own
  // id, so the linked account ties back to exactly one profile. If the user
  // hasn't submitted an astrologer application yet, create a bare pending
  // row here rather than failing the onboarding step on that.
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

  async saveRazorpayAccount(
    userId: string,
    data: {
      razorpayAccountId: string
      razorpayAccountStatus: string
      razorpayReferenceId: string
      razorpayAccountResponse: unknown
    },
  ) {
    const [profile] = await this.db
      .insert(astrologerProfiles)
      .values({
        userId,
        verificationStatus: 'pending',
        ...data,
        razorpayAccountCreatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: astrologerProfiles.userId,
        set: {
          ...data,
          razorpayAccountCreatedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning()
    return profile ?? null
  }
}