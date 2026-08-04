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
}