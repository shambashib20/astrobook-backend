import type { Database } from '@/core/database/client'
import {
  appointments,
  astrologerProfiles,
  consultationServices,
  consultationServiceVariants,
  VARIANT_DURATIONS,
  VARIANT_DEFAULT_PRICES,
  posts,
  users,
} from '@/core/database/schema'
import { and, count, desc, eq, gte, ilike, lte, or, sql, sum } from 'drizzle-orm'
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
      videoUrl: astrologerProfiles.videoUrl,
      rejectionReason: astrologerProfiles.rejectionReason,
      verifiedAt: astrologerProfiles.verifiedAt,
      // commissionPercentage sits in users.meta (jsonb), not its own column —
      // see backfill-commission-percentage.ts / updateVerification above.
      // Cast to float8 (not ::numeric) — the pg driver returns NUMERIC
      // columns as strings to avoid precision loss, which silently turned
      // this into a string in the JSON response despite the number type here.
      commissionPercentage: sql<number | null>`(${users.meta}->>'commissionPercentage')::float8`,
      // Cashfree Easy Split reconciliation fields — commented out during
      // the Razorpay rollback (kept, not deleted, for a quick re-migration).
      // cashfreeVendorId: astrologerProfiles.cashfreeVendorId,
      // cashfreeVendorStatus: astrologerProfiles.cashfreeVendorStatus,
      // cashfreeVendorResponse: astrologerProfiles.cashfreeVendorResponse,
      // cashfreeVendorCreatedAt: astrologerProfiles.cashfreeVendorCreatedAt,
      // Where to send this astrologer's manual payout (no Razorpay Route —
      // all payments settle into the platform account; admin reconciles and
      // pays out using these details). Admin-only endpoint.
      payoutMethod: astrologerProfiles.payoutMethod,
      payoutDetails: astrologerProfiles.payoutDetails,
      payoutDetailsUpdatedAt: astrologerProfiles.payoutDetailsUpdatedAt,
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
    // Cashfree onboarding-status filter — commented out during the
    // Razorpay rollback (kept, not deleted, for a quick re-migration).
    // if (filters.cashfreeStatus === 'onboarded') {
    //   conditions.push(isNotNull(astrologerProfiles.cashfreeVendorId))
    // } else if (filters.cashfreeStatus === 'not_onboarded') {
    //   conditions.push(isNull(astrologerProfiles.cashfreeVendorId))
    // }

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

  // Cashfree vendor-status cache update — commented out during the
  // Razorpay rollback (kept, not deleted, for a quick re-migration).
  // async updateCashfreeVendorCache(userId: string, data: {...}) { ... }

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
            // Naye astrologer ko default commissionPercentage:30 milta hai
            // meta mein (Astrobook's platform default) — sirf tab set karte
            // hain jab already nahi hai (existing meta keys preserve rehte
            // hain, aur re-approval pe admin-set value overwrite nahi hoti).
            meta: sql`CASE
              WHEN COALESCE(${users.meta}, '{}'::jsonb) ? 'commissionPercentage'
                THEN COALESCE(${users.meta}, '{}'::jsonb)
              ELSE COALESCE(${users.meta}, '{}'::jsonb) || '{"commissionPercentage": 30}'::jsonb
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

  async updateCommissionPercentage(userId: string, commissionPercentage: number) {
    const [user] = await this.db
      .update(users)
      .set({
        // Merge into existing meta — other keys (if any) stay untouched.
        meta: sql`COALESCE(${users.meta}, '{}'::jsonb) || jsonb_build_object('commissionPercentage', ${commissionPercentage}::numeric)`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId))
      .returning()
    return user ?? null
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

  // ── Earnings: per-astrologer revenue breakdown ────────────────────────────
  // "completed" appointments ka price sum, grouped by astrologer.
  // commissionPercentage user.meta JSONB se nikalta hai.
  //
  // BUG FIX: Previously used Drizzle ORM helpers (eq/gte/lte) to build WHERE
  // conditions, which generate `"appointments"."column"` qualified names.
  // But when the FROM clause uses `FROM ${appointments} a` (aliased as 'a'),
  // PostgreSQL hides the original table name — so `"appointments"."status"`
  // causes: ERROR 42P01 invalid reference to FROM-clause entry for table
  // "appointments". Fix: all conditions in aliased raw SQL must use the alias.
  async getEarningsSummary(opts: {
    page: number
    limit: number
    astrologerId?: string
    dateFrom?: string
    dateTo?: string
  }) {
    const { page, limit, astrologerId, dateFrom, dateTo } = opts
    const offset = (page - 1) * limit

    // Build WHERE fragments using raw SQL with alias 'a'
    const extraConditions: ReturnType<typeof sql>[] = []
    if (astrologerId) extraConditions.push(sql`AND a.astrologer_id = ${astrologerId}`)
    if (dateFrom) extraConditions.push(sql`AND a.scheduled_at >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`)
    if (dateTo) extraConditions.push(sql`AND a.scheduled_at <= ${new Date(`${dateTo}T23:59:59.999Z`)}`)
    const extraWhere = extraConditions.length > 0
      ? sql.join(extraConditions, sql` `)
      : sql``

    // Raw SQL for aggregation with JSONB commission extraction
    const rows = await this.db.execute<{
      astrologer_id: string
      astrologer_name: string | null
      avatar_url: string | null
      total_sessions: number
      gross_revenue: string
      commission_pct: number
      platform_revenue: string
      astrologer_payout: string
    }>(sql`
      SELECT
        u.id                                                                AS astrologer_id,
        u.name                                                              AS astrologer_name,
        u.avatar_url                                                        AS avatar_url,
        COUNT(a.id)::int                                                    AS total_sessions,
        COALESCE(SUM(CAST(a.price AS numeric)), 0)::text                   AS gross_revenue,
        COALESCE((u.meta->>'commissionPercentage')::numeric, 30)           AS commission_pct,
        (COALESCE(SUM(CAST(a.price AS numeric)), 0)
          * COALESCE((u.meta->>'commissionPercentage')::numeric, 30) / 100)::text
                                                                           AS platform_revenue,
        (COALESCE(SUM(CAST(a.price AS numeric)), 0)
          * (1 - COALESCE((u.meta->>'commissionPercentage')::numeric, 30) / 100))::text
                                                                           AS astrologer_payout
      FROM ${appointments} a
      JOIN ${users} u ON u.id = a.astrologer_id
      WHERE a.status = 'completed'
      ${extraWhere}
      GROUP BY u.id, u.name, u.avatar_url, u.meta
      ORDER BY COALESCE(SUM(CAST(a.price AS numeric)), 0) DESC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const totalResult = await this.db.execute<{ cnt: number }>(sql`
      SELECT COUNT(DISTINCT a.astrologer_id)::int AS cnt
      FROM ${appointments} a
      WHERE a.status = 'completed'
      ${extraWhere}
    `)

    return { rows: rows.rows, total: totalResult.rows[0]?.cnt ?? 0 }
  }

  // Overall platform revenue summary (totals)
  async getRevenueTotals(opts: { dateFrom?: string; dateTo?: string }) {
    // Same alias fix as getEarningsSummary — raw SQL only inside aliased query
    const extraConditions: ReturnType<typeof sql>[] = []
    if (opts.dateFrom) extraConditions.push(sql`AND a.scheduled_at >= ${new Date(`${opts.dateFrom}T00:00:00.000Z`)}`)
    if (opts.dateTo) extraConditions.push(sql`AND a.scheduled_at <= ${new Date(`${opts.dateTo}T23:59:59.999Z`)}`)
    const extraWhere = extraConditions.length > 0
      ? sql.join(extraConditions, sql` `)
      : sql``

    const revenueResult = await this.db.execute<{
      total_sessions: number
      gross_revenue: string
      platform_revenue: string
    }>(sql`
      SELECT
        COUNT(a.id)::int                                                         AS total_sessions,
        COALESCE(SUM(CAST(a.price AS numeric)), 0)::text                        AS gross_revenue,
        COALESCE(SUM(
          CAST(a.price AS numeric)
          * COALESCE((u.meta->>'commissionPercentage')::numeric, 30) / 100
        ), 0)::text                                                              AS platform_revenue
      FROM ${appointments} a
      JOIN ${users} u ON u.id = a.astrologer_id
      WHERE a.status = 'completed'
      ${extraWhere}
    `)

    const row = revenueResult.rows[0]
    return {
      totalSessions: row?.total_sessions ?? 0,
      grossRevenue: row?.gross_revenue ?? '0',
      platformRevenue: row?.platform_revenue ?? '0',
    }
  }

  // ── Payouts ──────────────────────────────────────────────────────────────

  async listPayoutRecords(opts: {
    page: number
    limit: number
    status?: string
    astrologerId?: string
  }) {
    const { page, limit } = opts
    const offset = (page - 1) * limit

    const conditions: ReturnType<typeof sql>[] = []
    if (opts.status) conditions.push(sql`pr.status = ${opts.status}`)
    if (opts.astrologerId) conditions.push(sql`pr.astrologer_id = ${opts.astrologerId}`)
    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``

    const rows = await this.db.execute<{
      id: string
      astrologer_id: string
      astrologer_name: string | null
      avatar_url: string | null
      amount: string
      status: string
      payout_method: string | null
      reference_id: string | null
      notes: string | null
      period_from: string | null
      period_to: string | null
      created_at: string
      updated_at: string
    }>(sql`
      SELECT
        pr.id, pr.astrologer_id,
        u.name AS astrologer_name, u.avatar_url,
        pr.amount::text, pr.status, pr.payout_method,
        pr.reference_id, pr.notes,
        pr.period_from, pr.period_to,
        pr.created_at, pr.updated_at
      FROM payout_records pr
      JOIN ${users} u ON u.id = pr.astrologer_id
      ${whereClause}
      ORDER BY pr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const totalResult = await this.db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt
      FROM payout_records pr
      ${whereClause}
    `)

    return { rows: rows.rows, total: totalResult.rows[0]?.cnt ?? 0 }
  }

  async createPayoutRecord(data: {
    astrologerId: string
    amount: number
    payoutMethod?: string
    referenceId?: string
    notes?: string
    periodFrom?: Date
    periodTo?: Date
    createdBy: string
  }) {
    const result = await this.db.execute<{ id: string }>(sql`
      INSERT INTO payout_records
        (astrologer_id, amount, status, payout_method, reference_id, notes,
         period_from, period_to, created_by)
      VALUES
        (${data.astrologerId}, ${data.amount}, 'pending',
         ${data.payoutMethod ?? null}, ${data.referenceId ?? null},
         ${data.notes ?? null}, ${data.periodFrom ?? null}, ${data.periodTo ?? null},
         ${data.createdBy})
      RETURNING id
    `)
    return result.rows[0]
  }

  async updatePayoutStatus(id: string, status: string, referenceId?: string, notes?: string) {
    await this.db.execute(sql`
      UPDATE payout_records
      SET status = ${status},
          reference_id = COALESCE(${referenceId ?? null}, reference_id),
          notes = COALESCE(${notes ?? null}, notes),
          updated_at = now()
      WHERE id = ${id}
    `)
  }

  async findPayoutById(id: string) {
    const result = await this.db.execute<{ id: string; astrologer_id: string; status: string }>(sql`
      SELECT id, astrologer_id, status FROM payout_records WHERE id = ${id}
    `)
    return result.rows[0] ?? null
  }

  async getAstrologerPayoutSummary(astrologerId: string) {
    const result = await this.db.execute<{
      total_earnings: string
      total_paid: string
      pending_amount: string
      session_count: number
    }>(sql`
      SELECT
        COALESCE(SUM(CAST(a.price AS numeric))
          * (1 - COALESCE((u.meta->>'commissionPercentage')::numeric, 30) / 100), 0)::text
                                              AS total_earnings,
        COALESCE((
          SELECT SUM(amount) FROM payout_records
          WHERE astrologer_id = ${astrologerId} AND status = 'paid'
        ), 0)::text                           AS total_paid,
        COALESCE((
          SELECT SUM(amount) FROM payout_records
          WHERE astrologer_id = ${astrologerId} AND status = 'pending'
        ), 0)::text                           AS pending_amount,
        COUNT(a.id)::int                      AS session_count
      FROM ${appointments} a
      JOIN ${users} u ON u.id = a.astrologer_id
      WHERE a.astrologer_id = ${astrologerId}
        AND a.status = 'completed'
    `)
    const row = result.rows[0]
    return {
      totalEarnings: row?.total_earnings ?? '0',
      totalPaid: row?.total_paid ?? '0',
      pendingAmount: row?.pending_amount ?? '0',
      sessionCount: row?.session_count ?? 0,
    }
  }
}