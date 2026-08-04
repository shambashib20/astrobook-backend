import { eq, and, sql, desc, inArray, asc } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import {
  consultationServices,
  consultationServiceVariants,
  VARIANT_DURATIONS,
  VARIANT_DEFAULT_PRICES,
  users,
} from '@/core/database/schema'
import type { CreateServiceDto, UpdateServiceDto } from '../schemas/consultation.schema'

const BASIC_SERVICE_DEFAULTS = {
  title: 'Basic Consultation',
  shortDescription: 'A quick starter consultation to get to know your concerns.',
  about:
    'This is your Basic consultation slot — a short session to discuss your questions and provide initial guidance. You can update the price anytime from your dashboard.',
} as const

// 30-min variant ka default price hi service-level mirror column (backward
// compat ke liye — browse/cart card listings isi se price dikhate hain)
const DEFAULT_VARIANT_DURATION = 30

export class ServiceRepository {
  constructor(private readonly db: Database) {}

  // Har service (Basic ho ya normal) ke saath fixed 5 duration variants
  // auto-create karta hai — 10/30/45/60/90 min, default prices ke saath.
  // 30-min wala isDefault=true (user detail page pe pre-selected rehta hai).
  private async createVariantsForService(serviceId: string) {
    const rows = VARIANT_DURATIONS.map((duration) => ({
      serviceId,
      durationMinutes: duration,
      price: VARIANT_DEFAULT_PRICES[duration],
      isDefault: duration === DEFAULT_VARIANT_DURATION,
    }))
    return this.db.insert(consultationServiceVariants).values(rows).returning()
  }

  // Astrologer khud ek nayi "normal" service banata hai — koi natural
  // uniqueness key nahi (Premium/Elite tier hata diya), har call ek nayi row.
  // Duration/price ab service-level pe nahi liya jaata — 5 variants
  // auto-create hote hain default prices ke saath.
  async create(astrologerId: string, dto: CreateServiceDto) {
    const [service] = await this.db
      .insert(consultationServices)
      .values({
        astrologerId,
        isBasic: false,
        title: dto.title,
        shortDescription: dto.shortDescription,
        coverImage: dto.coverImage,
        about: dto.about,
        durationMinutes: DEFAULT_VARIANT_DURATION,
        price: VARIANT_DEFAULT_PRICES[DEFAULT_VARIANT_DURATION],
        tags: dto.tags,
        isActive: true,
      })
      .returning()
    const variants = await this.createVariantsForService(service!.id)
    return { ...service!, variants }
  }

  // Platform ka auto-created "Basic" consultancy — admin approval flow
  // (admin module's updateVerification) se call hota hai jab astrologer
  // application approve hoti hai (koi image nahi). Isko bhi 5 variants milte
  // hain jaisi kisi normal service ko milte hain.
  async createBasic(astrologerId: string) {
    const [service] = await this.db
      .insert(consultationServices)
      .values({
        astrologerId,
        isBasic: true,
        title: BASIC_SERVICE_DEFAULTS.title,
        shortDescription: BASIC_SERVICE_DEFAULTS.shortDescription,
        coverImage: null,
        about: BASIC_SERVICE_DEFAULTS.about,
        durationMinutes: DEFAULT_VARIANT_DURATION,
        price: VARIANT_DEFAULT_PRICES[DEFAULT_VARIANT_DURATION],
        tags: [],
        isActive: true,
      })
      .returning()
    const variants = await this.createVariantsForService(service!.id)
    return { ...service!, variants }
  }

  // Service ke basic fields edit karna (title/desc/cover/about/tags) —
  // price/duration ab variant-level pe edit hota hai, is method se nahi.
  async update(id: string, astrologerId: string, dto: UpdateServiceDto) {
    const [service] = await this.db
      .update(consultationServices)
      .set({
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.shortDescription !== undefined && { shortDescription: dto.shortDescription }),
        ...(dto.coverImage !== undefined && { coverImage: dto.coverImage }),
        ...(dto.about !== undefined && { about: dto.about }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(consultationServices.id, id), eq(consultationServices.astrologerId, astrologerId)),
      )
      .returning()
    return service ?? null
  }

  async findById(id: string) {
    const [service] = await this.db
      .select()
      .from(consultationServices)
      .where(eq(consultationServices.id, id))
      .limit(1)
    return service ?? null
  }

  // Cart enrichment ke liye — ek saath multiple service ids fetch karo (N+1 avoid)
  async findByIds(ids: string[]) {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(consultationServices)
      .where(inArray(consultationServices.id, ids))
  }

  // Basic sabse pehle, phir naye se purane
  async findByAstrologer(astrologerId: string) {
    return this.db
      .select()
      .from(consultationServices)
      .where(
        and(
          eq(consultationServices.astrologerId, astrologerId),
          eq(consultationServices.isActive, true),
        ),
      )
      .orderBy(desc(consultationServices.isBasic), consultationServices.createdAt)
  }

  async deactivate(id: string, astrologerId: string) {
    const [service] = await this.db
      .update(consultationServices)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(
        and(eq(consultationServices.id, id), eq(consultationServices.astrologerId, astrologerId)),
      )
      .returning()
    return service ?? null
  }

  // Ek category/tag ke saare (kisi bhi astrologer ke) active normal services —
  // Explore category detail page ke "Consultancies" section ke liye
  async findByTag(tag: string, limit = 20, offset = 0) {
    return this.db
      .select({
        id: consultationServices.id,
        astrologerId: consultationServices.astrologerId,
        astrologerName: users.name,
        title: consultationServices.title,
        shortDescription: consultationServices.shortDescription,
        coverImage: consultationServices.coverImage,
        durationMinutes: consultationServices.durationMinutes,
        price: consultationServices.price,
        tags: consultationServices.tags,
      })
      .from(consultationServices)
      .innerJoin(users, eq(consultationServices.astrologerId, users.id))
      .where(
        and(
          eq(consultationServices.isActive, true),
          eq(consultationServices.isBasic, false),
          sql`${tag} = ANY(${consultationServices.tags})`,
        ),
      )
      .orderBy(desc(consultationServices.createdAt))
      .limit(limit)
      .offset(offset)
  }

  // ── Variants ────────────────────────────────────────────────────────────

  async findVariantsByService(serviceId: string) {
    return this.db
      .select()
      .from(consultationServiceVariants)
      .where(eq(consultationServiceVariants.serviceId, serviceId))
      .orderBy(asc(consultationServiceVariants.durationMinutes))
  }

  // Cart/appointment enrichment ke liye — ek saath multiple variant ids
  async findVariantsByIds(ids: string[]) {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(consultationServiceVariants)
      .where(inArray(consultationServiceVariants.id, ids))
  }

  async findVariantById(id: string) {
    const [variant] = await this.db
      .select()
      .from(consultationServiceVariants)
      .where(eq(consultationServiceVariants.id, id))
      .limit(1)
    return variant ?? null
  }

  async findDefaultVariant(serviceId: string) {
    const [variant] = await this.db
      .select()
      .from(consultationServiceVariants)
      .where(
        and(
          eq(consultationServiceVariants.serviceId, serviceId),
          eq(consultationServiceVariants.isDefault, true),
        ),
      )
      .limit(1)
    return variant ?? null
  }

  // Astrologer sirf price edit kar sakta hai — duration fixed hai
  async updateVariantPrice(variantId: string, price: number) {
    const [variant] = await this.db
      .update(consultationServiceVariants)
      .set({ price: String(price), updatedAt: sql`now()` })
      .where(eq(consultationServiceVariants.id, variantId))
      .returning()
    return variant ?? null
  }

  // Default (30-min) variant ka price change ho toh service-level mirror
  // column bhi sync rakho — purani listing/browse/cart-card queries jo
  // seedha consultationServices.price padhte hain, unhe bina chhue kaam
  // karte rehna chahiye.
  async syncServiceMirrorPrice(serviceId: string, price: string) {
    await this.db
      .update(consultationServices)
      .set({ price, updatedAt: sql`now()` })
      .where(eq(consultationServices.id, serviceId))
  }
}
