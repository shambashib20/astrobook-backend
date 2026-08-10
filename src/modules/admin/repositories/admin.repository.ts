import type { Database } from '@/core/database/client'
import {
  astrologerProfiles,
  consultationServices,
  consultationServiceVariants,
  VARIANT_DURATIONS,
  VARIANT_DEFAULT_PRICES,
  posts,
  users,
} from '@/core/database/schema'
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type {
  ListAstrologersQueryDto,
  ListPostsQueryDto,
  ListUsersQueryDto,
  UpdateDocumentsDto,
} from '../schemas/admin.schema'

// Approval pe naye astrologer ko milne wali default service — same defaults
// jo pehle user-side upgrade flow mein the (ab yahan hai kyunki role flip
// ka moment bhi yahi hai). Duration/price ab yahan se nahi — 5 fixed
// variants approval ke waqt hi auto-create hote hain (neeche dekho).
const BASIC_SERVICE_DEFAULTS = {
  title: 'Basic Consultation',
  shortDescription: 'A quick starter consultation to get to know your concerns.',
  about:
    'This is your Basic consultation slot — a short session to discuss your questions and provide initial guidance. You can update the price anytime from your dashboard.',
  durationMinutes: 30,
  price: VARIANT_DEFAULT_PRICES[30],
} as const

export class AdminRepository {
  constructor(private readonly db: Database) {}

  // ── Dashboard stats ───────────────────────────────────────────────────────

  async getStats() {
    const [[userCount], [astrologerCount], [pendingCount], [postCount], [bannedCount]] =
      await Promise.all([
        this.db.select({ value: count() }).from(users),
        this.db.select({ value: count() }).from(users).where(eq(users.isAstrologer, true)),
        this.db
          .select({ value: count() })
          .from(astrologerProfiles)
          .where(eq(astrologerProfiles.verificationStatus, 'pending')),
        this.db.select({ value: count() }).from(posts),
        this.db.select({ value: count() }).from(users).where(eq(users.isBanned, true)),
      ])

    return {
      totalUsers: userCount?.value ?? 0,
      totalAstrologers: astrologerCount?.value ?? 0,
      pendingVerifications: pendingCount?.value ?? 0,
      totalPosts: postCount?.value ?? 0,
      bannedUsers: bannedCount?.value ?? 0,
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async listUsers(filters: ListUsersQueryDto) {
    const conditions = []
    if (filters.search) {
      const term = `%${filters.search}%`
      conditions.push(
        or(ilike(users.name, term), ilike(users.phone, term), ilike(users.email, term)),
      )
    }
    if (filters.role) conditions.push(eq(users.role, filters.role))
    if (filters.isBanned !== undefined) conditions.push(eq(users.isBanned, filters.isBanned))

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const offset = (filters.page - 1) * filters.limit

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(filters.limit)
        .offset(offset),
      this.db.select({ value: count() }).from(users).where(where),
    ])

    return { rows, total: totalRow?.value ?? 0 }
  }

  async findUserById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return user ?? null
  }

  async setBanStatus(userId: string, isBanned: boolean, reason?: string) {
    const [user] = await this.db
      .update(users)
      .set({ isBanned, banReason: isBanned ? (reason ?? null) : null, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
  }

  async updateUserRole(userId: string, role: 'user' | 'astrologer' | 'admin') {
    const [user] = await this.db
      .update(users)
      .set({ role, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
  }

  async deleteUser(userId: string) {
    await this.db.delete(users).where(eq(users.id, userId))
  }

  // ── Astrologers / Verification ──────────────────────────────────────────────

  private astrologerSelect() {
    return {
      // user fields
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      avatarUrl: users.avatarUrl,
      isBanned: users.isBanned,
      createdAt: users.createdAt,
      // profile fields
      profileId: astrologerProfiles.id,
      bio: astrologerProfiles.bio,
      experience: astrologerProfiles.experience,
      languages: astrologerProfiles.languages,
      specializations: astrologerProfiles.specializations,
      photoUrl: astrologerProfiles.photoUrl,
      rating: astrologerProfiles.rating,
      totalReviews: astrologerProfiles.totalReviews,
      isVerified: astrologerProfiles.isVerified,
      isActive: astrologerProfiles.isActive,
      verificationStatus: astrologerProfiles.verificationStatus,
      document1Url: astrologerProfiles.document1Url,
      document2Url: astrologerProfiles.document2Url,
      rejectionReason: astrologerProfiles.rejectionReason,
      verifiedAt: astrologerProfiles.verifiedAt,
    }
  }

  async listAstrologers(filters: ListAstrologersQueryDto) {
    // Note: yahan isAstrologer=true filter NAHI hai jaan-boojh ke — pending
    // applicants abhi tak astrologer nahi bane hote (role flip sirf approval
    // pe hota hai), lekin unka astrologerProfiles row already ban chuka hota
    // hai jab wo application submit karte hain. INNER JOIN hi kaafi hai scope
    // ke liye: "jinhone application di hai".
    const conditions = []
    if (filters.search) {
      const term = `%${filters.search}%`
      const searchCondition = or(ilike(users.name, term), ilike(users.phone, term))
      if (searchCondition) conditions.push(searchCondition)
    }
    if (filters.status) conditions.push(eq(astrologerProfiles.verificationStatus, filters.status))

    const where = and(...conditions)
    const offset = (filters.page - 1) * filters.limit

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select(this.astrologerSelect())
        .from(users)
        .innerJoin(astrologerProfiles, eq(astrologerProfiles.userId, users.id))
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(filters.limit)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(users)
        .innerJoin(astrologerProfiles, eq(astrologerProfiles.userId, users.id))
        .where(where),
    ])

    return { rows, total: totalRow?.value ?? 0 }
  }

  async findAstrologerById(userId: string) {
    const [row] = await this.db
      .select(this.astrologerSelect())
      .from(users)
      .innerJoin(astrologerProfiles, eq(astrologerProfiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1)
    return row ?? null
  }

  async updateDocuments(userId: string, dto: UpdateDocumentsDto) {
    const [profile] = await this.db
      .update(astrologerProfiles)
      .set({
        ...(dto.document1Url !== undefined ? { document1Url: dto.document1Url } : {}),
        ...(dto.document2Url !== undefined ? { document2Url: dto.document2Url } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(astrologerProfiles.userId, userId))
      .returning()
    return profile ?? null
  }

  async updateVerification(
    userId: string,
    status: 'pending' | 'approved' | 'rejected',
    adminId: string,
    rejectionReason?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [profile] = await tx
        .update(astrologerProfiles)
        .set({
          verificationStatus: status,
          isVerified: status === 'approved',
          rejectionReason: status === 'rejected' ? (rejectionReason ?? null) : null,
          verifiedAt: status === 'pending' ? null : sql`now()`,
          verifiedBy: status === 'pending' ? null : adminId,
          updatedAt: sql`now()`,
        })
        .where(eq(astrologerProfiles.userId, userId))
        .returning()

      if (!profile) return null

      // Approval hi actual "banna astrologer" moment hai — yahi pe role
      // flip hota hai aur default Basic Consultation service milti hai.
      // Reject/pending pe role 'user' hi rehta hai.
      if (status === 'approved') {
        await tx
          .update(users)
          .set({
            role: 'astrologer',
            isAstrologer: true,
            updatedAt: sql`now()`,
            // Naye astrologer ko default commissionPercentage:0 milta hai
            // meta mein — sirf tab set karte hain jab already nahi hai
            // (existing meta keys preserve rehte hain, aur re-approval pe
            // admin-set value overwrite nahi hoti).
            meta: sql`CASE
              WHEN COALESCE(${users.meta}, '{}'::jsonb) ? 'commissionPercentage'
                THEN COALESCE(${users.meta}, '{}'::jsonb)
              ELSE COALESCE(${users.meta}, '{}'::jsonb) || '{"commissionPercentage": 0}'::jsonb
            END`,
          })
          .where(eq(users.id, userId))

        const [existingBasic] = await tx
          .select({ id: consultationServices.id })
          .from(consultationServices)
          .where(
            and(eq(consultationServices.astrologerId, userId), eq(consultationServices.isBasic, true)),
          )
          .limit(1)

        if (!existingBasic) {
          const [basicService] = await tx
            .insert(consultationServices)
            .values({
              astrologerId: userId,
              isBasic: true,
              title: BASIC_SERVICE_DEFAULTS.title,
              shortDescription: BASIC_SERVICE_DEFAULTS.shortDescription,
              coverImage: null,
              about: BASIC_SERVICE_DEFAULTS.about,
              durationMinutes: BASIC_SERVICE_DEFAULTS.durationMinutes,
              price: BASIC_SERVICE_DEFAULTS.price,
              tags: [],
              isActive: true,
            })
            .returning({ id: consultationServices.id })

          // 5 fixed duration variants (10/30/45/60/90 min) auto-create —
          // 30-min wala isDefault=true, baaki default prices ke saath.
          if (basicService) {
            await tx.insert(consultationServiceVariants).values(
              VARIANT_DURATIONS.map((duration) => ({
                serviceId: basicService.id,
                durationMinutes: duration,
                price: VARIANT_DEFAULT_PRICES[duration],
                isDefault: duration === 30,
              })),
            )
          }
        }
      }

      // Reject/reset-to-pending pe role wapas 'user' — agar pehle kisi
      // wajah se astrologer ban chuka tha (edge case: dobara review khola)
      if (status !== 'approved') {
        await tx
          .update(users)
          .set({ role: 'user', isAstrologer: false, updatedAt: sql`now()` })
          .where(eq(users.id, userId))
      }

      return profile
    })
  }

  // ── Posts (moderation) ──────────────────────────────────────────────────────

  async listPosts(filters: ListPostsQueryDto) {
    const conditions = []
    if (filters.astrologerId) conditions.push(eq(posts.astrologerId, filters.astrologerId))
    if (filters.search) conditions.push(ilike(posts.content, `%${filters.search}%`))

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const offset = (filters.page - 1) * filters.limit

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          id: posts.id,
          content: posts.content,
          mediaUrl: posts.mediaUrl,
          mediaType: posts.mediaType,
          tags: posts.tags,
          createdAt: posts.createdAt,
          astrologerId: posts.astrologerId,
          astrologerName: users.name,
          astrologerAvatarUrl: users.avatarUrl,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.astrologerId))
        .where(where)
        .orderBy(desc(posts.createdAt))
        .limit(filters.limit)
        .offset(offset),
      this.db.select({ value: count() }).from(posts).where(where),
    ])

    return { rows, total: totalRow?.value ?? 0 }
  }

  async deletePost(postId: string) {
    await this.db.delete(posts).where(eq(posts.id, postId))
  }

  async postExists(postId: string) {
    const [row] = await this.db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).limit(1)
    return !!row
  }
}