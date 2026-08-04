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

  async findAll() {
    return this.db.select().from(users).where(eq(users.isAstrologer, true))
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
  async findServices(astrologerId: string) {
    const services = await this.db
      .select()
      .from(consultationServices)
      .where(
        and(
          eq(consultationServices.astrologerId, astrologerId),
          eq(consultationServices.isActive, true),
        ),
      )
      .orderBy(desc(consultationServices.isBasic), consultationServices.createdAt)

    if (services.length === 0) return []

    const allVariants = await this.db
      .select()
      .from(consultationServiceVariants)
      .where(
        inArray(
          consultationServiceVariants.serviceId,
          services.map((s) => s.id),
        ),
      )
      .orderBy(asc(consultationServiceVariants.durationMinutes))

    return services.map((service) => ({
      ...service,
      variants: allVariants.filter((v) => v.serviceId === service.id),
    }))
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
