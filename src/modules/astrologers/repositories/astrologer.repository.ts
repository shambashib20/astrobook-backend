// src/modules/astrologers/repositories/astrologer.repository.ts
import { eq, and, gte, desc, inArray, asc } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import {
  users,
  consultationServices,
  consultationServiceVariants,
  availabilityWindows,
} from '@/core/database/schema'

export class AstrologerRepository {
  constructor(private readonly db: Database) {}

  // Unbounded before — fetched every astrologer row (every column) with no
  // limit, so response time scaled linearly with total astrologer count.
  //
  // Basic service price/id ab yahin LEFT JOIN se aata hai. Pehle frontend
  // list ke baad har astrologer ke liye alag se getServices() call karta
  // tha (N parallel Neon round trips, ek list mein 20 astrologers matlab 20
  // extra queries) — jo Neon ke cold-start/pooled-connection latency ke
  // saath milke poore tab switch ko multiple seconds tak freeze kar deta
  // tha. Ek hi query mein sab aane se woh N+1 poora khatam ho gaya.
  async findAll(limit = 50, offset = 0) {
    const rows = await this.db
      .select({
        user: users,
        basicServiceId: consultationServices.id,
        basicServicePrice: consultationServices.price,
      })
      .from(users)
      .leftJoin(
        consultationServices,
        and(
          eq(consultationServices.astrologerId, users.id),
          eq(consultationServices.isBasic, true),
          eq(consultationServices.isActive, true),
        ),
      )
      .where(eq(users.isAstrologer, true))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset)

    return rows.map((row) => ({
      ...row.user,
      basicServiceId: row.basicServiceId,
      basicPrice: row.basicServicePrice,
    }))
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
