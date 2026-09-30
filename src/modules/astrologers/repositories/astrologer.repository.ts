// src/modules/astrologers/repositories/astrologer.repository.ts
import { eq, and, gte, desc, inArray, asc, sql, or, ilike } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import {
  users,
  astrologerProfiles,
  consultationServices,
  consultationServiceVariants,
  availabilityWindows,
} from '@/core/database/schema'
import { ALL_CATEGORIES } from '@/modules/categories/constants'
import type { AstrologerListQuery } from '../schemas/astrologer.schema'

const CATEGORY_LABEL_BY_ID = new Map<string, string>(ALL_CATEGORIES.map((c) => [c.id, c.label]))

// "Abhi available" — astrologer ne abhi ke waqt ke liye availability window
// khol rakhi hai (window ke apne timezone mein). Booking slot-based hai, isliye
// alag se manual "go online" toggle nahi; availability hi online status hai.
const isOnlineExpr = sql<boolean>`exists (
  select 1 from ${availabilityWindows} w
  where w.astrologer_id = ${users.id}
    and w.is_active = true
    and w.date = (now() at time zone w.timezone)::date
    and w.start_time <= (now() at time zone w.timezone)::time
    and w.end_time > (now() at time zone w.timezone)::time
)`

const followersCountExpr = sql<number>`(
  select count(*)::int from follows f where f.following_id = ${users.id}
)`

// Astrologer ki saari active services ke tags (Explore ke category ids)
const serviceTagsExpr = sql<string[]>`coalesce((
  select array_agg(distinct t)
  from consultation_services s, unnest(s.tags) t
  where s.astrologer_id = ${users.id} and s.is_active = true
), '{}'::text[])`

const ratingExpr = sql<string | null>`${astrologerProfiles.rating}`

export class AstrologerRepository {
  constructor(private readonly db: Database) {}

  // Card ke liye saara data ek hi query mein — users + astrologer_profiles +
  // basic service + followers/online/tags subqueries. Koi N+1 nahi.
  // Sirf zaroori user columns select hote hain (passwordHash jaise fields
  // kabhi row mein aate hi nahi).
  private cardQuery() {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        interests: users.interests,
        meta: users.meta,
        isOnboarded: users.isOnboarded,
        createdAt: users.createdAt,
        basicServiceId: consultationServices.id,
        basicServicePrice: consultationServices.price,
        basicServiceDuration: consultationServices.durationMinutes,
        experience: astrologerProfiles.experience,
        languages: astrologerProfiles.languages,
        specializations: astrologerProfiles.specializations,
        rating: ratingExpr,
        totalReviews: astrologerProfiles.totalReviews,
        isVerified: astrologerProfiles.isVerified,
        serviceTags: serviceTagsExpr,
        followersCount: followersCountExpr,
        isOnline: isOnlineExpr,
      })
      .from(users)
      .innerJoin(astrologerProfiles, eq(astrologerProfiles.userId, users.id))
      .leftJoin(
        consultationServices,
        and(
          eq(consultationServices.astrologerId, users.id),
          eq(consultationServices.isBasic, true),
          eq(consultationServices.isActive, true),
        ),
      )
  }

  private orderByFor(sort: AstrologerListQuery['sort']): SQL[] {
    const rating = sql`coalesce(${astrologerProfiles.rating}, 0)`
    const reviews = sql`coalesce(${astrologerProfiles.totalReviews}, 0)`
    switch (sort) {
      case 'top_rated':
        return [sql`${rating} desc`, sql`${reviews} desc`, sql`${users.createdAt} desc`]
      case 'most_followed':
        return [sql`${followersCountExpr} desc`, sql`${rating} desc`, sql`${users.createdAt} desc`]
      case 'experienced':
        return [
          sql`coalesce(${astrologerProfiles.experience}, 0) desc`,
          sql`${rating} desc`,
          sql`${users.createdAt} desc`,
        ]
      case 'new':
        return [sql`${users.createdAt} desc`]
      case 'price_low':
        return [sql`${consultationServices.price} asc nulls last`, sql`${users.createdAt} desc`]
      default:
        // recommended: abhi available pehle, phir rating, phir naye
        return [
          sql`${isOnlineExpr} desc`,
          sql`${rating} desc`,
          sql`${reviews} desc`,
          sql`${users.createdAt} desc`,
        ]
    }
  }

  async findAll(query: AstrologerListQuery) {
    const conditions: (SQL | undefined)[] = [
      eq(users.isAstrologer, true),
      eq(users.isBanned, false),
      eq(astrologerProfiles.isActive, true),
    ]

    if (query.availability === 'online') conditions.push(isOnlineExpr)
    if (query.availability === 'offline') conditions.push(sql`not ${isOnlineExpr}`)

    // Top rated mein sirf woh jinka kam-se-kam ek review ho — warna 0-rating
    // wale bhi "top" dikhenge
    if (query.sort === 'top_rated') conditions.push(sql`${astrologerProfiles.totalReviews} > 0`)

    if (query.category) {
      conditions.push(
        or(
          sql`${query.category} = any(${astrologerProfiles.specializations})`,
          sql`exists (
            select 1 from consultation_services s
            where s.astrologer_id = ${users.id} and s.is_active = true
              and ${query.category} = any(s.tags)
          )`,
        ),
      )
    }

    const q = query.q?.replace(/[%_\\]/g, '')
    if (q) {
      const like = `%${q}%`
      conditions.push(
        or(
          ilike(users.name, like),
          sql`array_to_string(${astrologerProfiles.languages}, ' ') ilike ${like}`,
          sql`array_to_string(${astrologerProfiles.specializations}, ' ') ilike ${like}`,
          sql`exists (
            select 1 from consultation_services s, unnest(s.tags) t
            where s.astrologer_id = ${users.id} and s.is_active = true and t ilike ${like}
          )`,
        ),
      )
    }

    const rows = await this.cardQuery()
      .where(and(...conditions))
      .orderBy(...this.orderByFor(query.sort))
      .limit(query.limit)
      .offset(query.offset)

    return rows.map((row) => this.toCard(row))
  }

  // Favourites list / profile page ke liye — same card shape, given ids ke liye
  async findCardsByIds(ids: string[]) {
    if (ids.length === 0) return []
    const rows = await this.cardQuery().where(
      and(
        eq(users.isAstrologer, true),
        eq(users.isBanned, false),
        eq(astrologerProfiles.isActive, true),
        inArray(users.id, ids),
      ),
    )
    return rows.map((row) => this.toCard(row))
  }

  private toCard(row: Awaited<ReturnType<AstrologerRepository['cardQuery']>>[number]) {
    const rating = row.rating != null ? Number(row.rating) : 0
    const totalReviews = row.totalReviews ?? 0
    const experienceYears = row.experience ?? 0
    const languages = row.languages ?? []
    const specializations = row.specializations ?? []

    // Card pe categories: application mein chuni specializations aur services
    // ke tags — dono Explore ke category ids hain, isliye dono ko label mein
    // badalkar dedupe karte hain (case-insensitive)
    const seen = new Set<string>()
    const categories: string[] = []
    for (const raw of [...specializations, ...row.serviceTags].map(
      (id) => CATEGORY_LABEL_BY_ID.get(id) ?? id,
    )) {
      const key = raw.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      categories.push(raw.trim())
    }

    return {
      id: row.id,
      name: row.name ?? '',
      phone: row.phone,
      avatarUrl: row.avatarUrl,
      interests: row.interests,
      // Purani screens abhi bhi meta.* padhti hain — unhe bhi asli data mile
      meta: {
        ...(row.meta ?? {}),
        speciality: categories[0] ?? undefined,
        exp: experienceYears > 0 ? `${experienceYears} Years` : 'New',
        rating,
        reviews: totalReviews,
        languages: languages.join(', '),
        online: row.isOnline,
      },
      isOnboarded: row.isOnboarded,
      createdAt: row.createdAt,
      basicServiceId: row.basicServiceId,
      basicPrice: row.basicServicePrice,
      basicDurationMinutes: row.basicServiceDuration,
      experienceYears,
      languages,
      specializations,
      categories,
      rating,
      totalReviews,
      followersCount: row.followersCount,
      isOnline: row.isOnline,
      isVerified: row.isVerified,
    }
  }

  async findById(id: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isAstrologer, true)))
      .limit(1)
    return user ?? null
  }

  // Ek astrologer ki saari active services — variants (10/30/45/60/90 min +
  // price) bhi attach karke bhejte hain, kyunki app ka service-detail page
  // (Choose Duration section) yehi endpoint use karta hai aur ab alag se
  // variants fetch nahi karta — agar yahan attach na karein toh woh section
  // hamesha khaali/loading dikhega.
  // Was 2 sequential round trips (services, then variants filtered by the
  // service ids just fetched — a real data dependency between them). A
  // single LEFT JOIN gets both in one round trip; we just have to
  // de-duplicate the repeated service columns client-side afterwards.
  async findServices(astrologerId: string) {
    const rows = await this.db
      .select({
        service: consultationServices,
        variant: consultationServiceVariants,
      })
      .from(consultationServices)
      .leftJoin(
        consultationServiceVariants,
        eq(consultationServiceVariants.serviceId, consultationServices.id),
      )
      .where(
        and(
          eq(consultationServices.astrologerId, astrologerId),
          eq(consultationServices.isActive, true),
        ),
      )
      .orderBy(
        desc(consultationServices.isBasic),
        consultationServices.createdAt,
        asc(consultationServiceVariants.durationMinutes),
      )

    const serviceMap = new Map<string, (typeof rows)[number]['service'] & { variants: NonNullable<(typeof rows)[number]['variant']>[] }>()
    for (const row of rows) {
      let entry = serviceMap.get(row.service.id)
      if (!entry) {
        entry = { ...row.service, variants: [] }
        serviceMap.set(row.service.id, entry)
      }
      if (row.variant) entry.variants.push(row.variant)
    }

    return Array.from(serviceMap.values())
  }

  async findSlots(astrologerId: string) {
    const today = new Date().toISOString().split('T')[0]!
    return this.db
      .select()
      .from(availabilityWindows)
      .where(
        and(
          eq(availabilityWindows.astrologerId, astrologerId),
          eq(availabilityWindows.isActive, true),
          gte(availabilityWindows.date, today),
        ),
      )
      .orderBy(availabilityWindows.date)
  }
}
