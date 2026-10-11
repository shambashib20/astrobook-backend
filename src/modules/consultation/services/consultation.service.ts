import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { ServiceRepository } from '../repositories/service.repository'
import type { AvailabilityRepository } from '../repositories/availability.repository'
import type { AppointmentRepository } from '../repositories/appointment.repository'
import type { RecurringAvailabilityRepository } from '../repositories/recurring-availability.repository'
import type { SlotLockRepository } from '../repositories/slot-lock.repository'
import type {
  CreateServiceDto,
  UpdateServiceDto,
  CreateAvailabilityDto,
  CreateRecurringAvailabilityBatchDto,
  LockSlotDto,
  ReleaseSlotDto,
} from '../schemas/consultation.schema'

// ─── Slot Generation Helper ───────────────────────────────────────────────────

function toUtcTimestamp(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const [hours, minutes] = timeStr.split(':').map(Number) as [number, number]

  const wrongUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0)
  const wrongUtcDate = new Date(wrongUtcMs)

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })

  const parts = Object.fromEntries(fmt.formatToParts(wrongUtcDate).map((p) => [p.type, p.value]))
  const localHour = Number(parts['hour']) === 24 ? 0 : Number(parts['hour'])
  const wrongLocalMs = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    localHour,
    Number(parts['minute']),
    Number(parts['second']),
  )

  const offsetMs = wrongLocalMs - wrongUtcMs
  return new Date(wrongUtcMs - offsetMs)
}

export type TimeSlot = {
  startTime: string // ISO string
  endTime: string // ISO string
  available: boolean
  softLocked: boolean // Book My Show style — kisi aur ne 10 min ke liye reserve kar rakha hai
}

// ─── ConsultationService ──────────────────────────────────────────────────────

export class ConsultationService {
  constructor(
    private readonly serviceRepository: ServiceRepository,
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly recurringAvailabilityRepository: RecurringAvailabilityRepository,
    private readonly slotLockRepository: SlotLockRepository,
  ) {}

  // ── Astrologer: Services ───────────────────────────────────────────────────

  async createService(astrologerId: string, dto: CreateServiceDto) {
    return this.serviceRepository.create(astrologerId, dto)
  }

  async updateService(serviceId: string, astrologerId: string, dto: UpdateServiceDto) {
    const service = await this.serviceRepository.findById(serviceId)
    if (!service) throw NotFoundError('Service not found')
    if (service.astrologerId !== astrologerId) throw ForbiddenError('Not your service')
    return this.serviceRepository.update(serviceId, astrologerId, dto)
  }

  // Astrologer ki apni services (Basic + normal) — har service ke saath
  // uske 5 duration variants bhi attach karke bhejta hai (services.tsx
  // composer/edit UI ko variant price editors ke liye chahiye).
  async getMyServices(astrologerId: string) {
    const services = await this.serviceRepository.findByAstrologer(astrologerId)
    return this.attachVariants(services)
  }

  // Explore category detail page — kisi bhi astrologer ki us tag wali services
  async browseServicesByTag(tag: string, limit: number, offset: number) {
    return this.serviceRepository.findByTag(tag, limit, offset)
  }

  // ── Variants ──────────────────────────────────────────────────────────────

  // Ek service ke saare 5 duration variants — user detail page (variant
  // selector) aur astrologer edit modal, dono yahi endpoint use karte hain.
  async getServiceVariants(serviceId: string) {
    const service = await this.serviceRepository.findById(serviceId)
    if (!service) throw NotFoundError('Service not found')
    const variants = await this.serviceRepository.findVariantsByService(serviceId)
    if (variants.length > 0) return variants
    // Bina variants wali purani service — self-heal
    await this.serviceRepository.ensureVariants(serviceId)
    return this.serviceRepository.findVariantsByService(serviceId)
  }

  // Astrologer sirf price edit kar sakta hai (duration fixed hai, isliye
  // schema level pe hi duration accept nahi hota).
  async updateServiceVariant(
    serviceId: string,
    variantId: string,
    astrologerId: string,
    price: number,
  ) {
    const service = await this.serviceRepository.findById(serviceId)
    if (!service) throw NotFoundError('Service not found')
    if (service.astrologerId !== astrologerId) throw ForbiddenError('Not your service')

    const variant = await this.serviceRepository.findVariantById(variantId)
    if (!variant || variant.serviceId !== serviceId) {
      throw NotFoundError('Variant not found for this service')
    }

    const updated = await this.serviceRepository.updateVariantPrice(variantId, price)

    // 30-min (default) variant ka price service-level mirror column mein
    // bhi sync karo — purani browse/cart-card listing bina tootey chalti rahe
    if (variant.isDefault) {
      await this.serviceRepository.syncServiceMirrorPrice(serviceId, String(price))
    }

    return updated
  }

  // Booking/cart flow ke liye — variant fetch + ownership/active validation
  async getVariantForBooking(serviceId: string, variantId: string, astrologerId: string) {
    const service = await this.getServiceForBooking(serviceId, astrologerId)
    const variant = await this.serviceRepository.findVariantById(variantId)
    if (!variant || variant.serviceId !== service.id) {
      throw BadRequestError('Variant does not belong to the specified service')
    }
    return variant
  }

  async getDefaultVariant(serviceId: string) {
    let variant = await this.serviceRepository.findDefaultVariant(serviceId)
    if (!variant) {
      // Bina variants wali purani service — self-heal, phir dobara try
      await this.serviceRepository.ensureVariants(serviceId)
      variant = await this.serviceRepository.findDefaultVariant(serviceId)
    }
    if (!variant) throw NotFoundError('Default variant not found for this service')
    return variant
  }

  // Helper — services list ke saath unke variants attach karo (N+1 avoid
  // karne ke liye ek hi query se saare variants fetch karke group karte hain).
  // Self-heal: agar kisi service ke variants missing hain (drizzle-kit push
  // ne table wipe kar di ho), toh ensureVariants call karke dobara fetch karo.
  private async attachVariants<T extends { id: string }>(
    services: T[],
  ): Promise<(T & { variants: Awaited<ReturnType<ServiceRepository['findVariantsByService']>> })[]> {
    if (services.length === 0) return []
    let allVariants = await Promise.all(
      services.map((s) => this.serviceRepository.findVariantsByService(s.id)),
    )
    // Koi bhi service bina variants ke? ensureVariants se self-heal karo
    const healIndices = services.map((_, i) => i).filter((i) => allVariants[i]!.length === 0)
    if (healIndices.length > 0) {
      await Promise.allSettled(
        healIndices.map((i) => this.serviceRepository.ensureVariants(services[i]!.id)),
      )
      // Healed services ke variants dobara fetch karo
      const healed = await Promise.all(
        healIndices.map((i) => this.serviceRepository.findVariantsByService(services[i]!.id)),
      )
      healIndices.forEach((origIdx, healIdx) => {
        allVariants[origIdx] = healed[healIdx]!
      })
    }
    return services.map((service, i) => ({ ...service, variants: allVariants[i]! }))
  }

  async deactivateService(serviceId: string, astrologerId: string) {
    const service = await this.serviceRepository.findById(serviceId)
    if (!service) throw NotFoundError('Service not found')
    if (service.astrologerId !== astrologerId) throw ForbiddenError('Not your service')
    if (service.isBasic) {
      throw BadRequestError(
        'Basic consultation cannot be deleted — you can only edit its price and duration',
      )
    }
    return this.serviceRepository.deactivate(serviceId, astrologerId)
  }

  // User side — astrologer ki services (variants ke saath — profile page pe
  // "Book Now" price bhi default variant se aata hai, aur service-detail
  // page pe variant selector dikhta hai)
  async getAstrologerServices(astrologerId: string) {
    const services = await this.serviceRepository.findByAstrologer(astrologerId)
    return this.attachVariants(services)
  }

  async getServiceForBooking(serviceId: string, astrologerId: string) {
    const service = await this.serviceRepository.findById(serviceId)
    if (!service) throw NotFoundError('Service not found')
    if (service.astrologerId !== astrologerId) {
      throw BadRequestError('Service does not belong to the specified astrologer')
    }
    if (!service.isActive) throw BadRequestError('This service is currently unavailable')
    return service
  }

  // ── Astrologer: Availability ───────────────────────────────────────────────

  async setAvailability(astrologerId: string, dto: CreateAvailabilityDto) {
    return this.availabilityRepository.upsert(astrologerId, dto)
  }

  async getMyAvailability(astrologerId: string) {
    return this.availabilityRepository.findUpcomingByAstrologer(astrologerId)
  }

  async deleteAvailability(id: string, astrologerId: string) {
    const window = await this.availabilityRepository.findById(id)
    if (!window) throw NotFoundError('Availability window not found')
    if (window.astrologerId !== astrologerId) {
      throw ForbiddenError("You cannot delete another astrologer's availability")
    }
    return this.availabilityRepository.delete(id, astrologerId)
  }

  // ── Astrologer: Recurring Availability ────────────────────────────────────

  /**
   * Ek batch POST se multiple days set karo (Mon/Wed/Fri chips se).
   * Promise.allSettled use karta hai — partial success bhi ok hai.
   */
  async setRecurringAvailability(astrologerId: string, dto: CreateRecurringAvailabilityBatchDto) {
    const results = await Promise.allSettled(
      dto.daysOfWeek.map((dayOfWeek) =>
        this.recurringAvailabilityRepository.upsert(astrologerId, {
          dayOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
          timezone: dto.timezone ?? 'Asia/Kolkata',
        }),
      ),
    )
    return {
      created: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    }
  }

  async getMyRecurringAvailability(astrologerId: string) {
    return this.recurringAvailabilityRepository.findByAstrologer(astrologerId)
  }

  async deleteRecurringAvailability(id: string, astrologerId: string) {
    const pattern = await this.recurringAvailabilityRepository.findById(id)
    if (!pattern) throw NotFoundError('Recurring availability pattern not found')
    if (pattern.astrologerId !== astrologerId) {
      throw ForbiddenError("You cannot delete another astrologer's recurring pattern")
    }
    return this.recurringAvailabilityRepository.delete(id, astrologerId)
  }

  // ── User: Slot Locks ───────────────────────────────────────────────────────

  /** Slot soft-lock karo. Returns false agar kisi aur ka lock already hai. */
  async lockSlot(userId: string, dto: LockSlotDto): Promise<boolean> {
    const result = await this.slotLockRepository.acquireOrRefresh(
      dto.astrologerId,
      new Date(dto.slotStart),
      userId,
    )
    return result !== null
  }

  /** Slot release karo (user page se gaya ya deselect kiya). */
  async releaseSlot(userId: string, dto: ReleaseSlotDto): Promise<void> {
    await this.slotLockRepository.release(dto.astrologerId, new Date(dto.slotStart), userId)
  }

  /** User ke saare active locks release karo (page close / logout). */
  async releaseAllLocks(userId: string): Promise<void> {
    await this.slotLockRepository.releaseAllByUser(userId)
  }

  // ── User: Available Dates ──────────────────────────────────────────────────

  async getAvailableDates(astrologerId: string): Promise<string[]> {
    // Specific date windows
    const windows = await this.availabilityRepository.findUpcomingByAstrologer(astrologerId)
    const specificDates = windows.map((w) => w.date)

    // Recurring patterns — agle 30 din mein matching dayOfWeek wale dates
    const recurringPatterns =
      await this.recurringAvailabilityRepository.findByAstrologer(astrologerId)
    const recurringDates: string[] = []
    if (recurringPatterns.length > 0) {
      const activeDaysOfWeek = new Set(recurringPatterns.map((p) => p.dayOfWeek))
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (let i = 0; i < 30; i++) {
        const d = new Date(today)
        d.setDate(today.getDate() + i)
        if (activeDaysOfWeek.has(d.getDay())) {
          const year = d.getFullYear()
          const month = String(d.getMonth() + 1).padStart(2, '0')
          const day = String(d.getDate()).padStart(2, '0')
          recurringDates.push(`${year}-${month}-${day}`)
        }
      }
    }

    // Merge + deduplicate + sort
    const allDates = Array.from(new Set([...specificDates, ...recurringDates]))
    return allDates.sort()
  }

  async getAvailabilityForDate(astrologerId: string, date: string) {
    return this.availabilityRepository.findAllByDate(astrologerId, date)
  }

  // ── User: Available Slots (MAIN FUNCTION) ─────────────────────────────────
  //
  // Algorithm:
  //   1. Fetch ALL availability windows for the date (astrologer ke multiple
  //      time ranges ho sakte hain — e.g. 11-1pm, 3-5pm, 8-10pm)
  //   2. Get all confirmed/ongoing appointments for that astrologer that day
  //   3. Har window ke andar slots of durationMinutes generate karo
  //   4. Mark slots as unavailable if they overlap with existing bookings
  //   5. Saare windows ke slots merge + chronologically sort karke return karo

  async getAvailableSlots(
    astrologerId: string,
    serviceId: string,
    date: string,
    variantId?: string,
  ): Promise<TimeSlot[]> {
    // Service fetch karo
    const service = await this.serviceRepository.findById(serviceId)
    if (!service) throw NotFoundError('Service not found')
    if (!service.isActive) throw BadRequestError('Service is not active')

    // Duration variant se aati hai — koi variant na diya ho toh default (30-min)
    const variant = variantId
      ? await this.serviceRepository.findVariantById(variantId)
      : await this.getDefaultVariant(serviceId)
    if (!variant || variant.serviceId !== serviceId) {
      throw BadRequestError('Variant does not belong to the specified service')
    }

    // Us din ke saare specific availability windows fetch karo
    const specificWindows = await this.availabilityRepository.findAllByDate(astrologerId, date)

    // Us din ke dayOfWeek ke recurring patterns bhi fetch karo
    const dayOfWeek = new Date(`${date}T00:00:00`).getDay()
    const recurringPatterns = await this.recurringAvailabilityRepository.findByAstrologerAndDays(
      astrologerId,
      [dayOfWeek],
    )

    // Recurring patterns ko window format mein convert karo (date attach karke)
    const recurringWindows = recurringPatterns.map((p) => ({
      date,
      startTime: p.startTime,
      endTime: p.endTime,
      timezone: p.timezone,
    }))

    // Dono combine karo — specific + recurring
    const windows = [...specificWindows, ...recurringWindows]
    if (windows.length === 0) return [] // Koi availability nahi

    const durationMs = variant.durationMinutes * 60 * 1000

    // Existing bookings — poore din ke liye ek hi baar fetch karo (sabse
    // pehli window ke start se sabse aakhri window ke end tak cover karega)
    const dayStart = toUtcTimestamp(date, '00:00', windows[0]!.timezone)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const existingBookings = await this.appointmentRepository.findConfirmedByAstrologerInRange(
      astrologerId,
      dayStart,
      dayEnd,
    )

    // Active slot locks fetch karo (poore din ke liye)
    const activeLocks = await this.slotLockRepository.findActiveByAstrologerInRange(
      astrologerId,
      dayStart,
      dayEnd,
    )
    // ISO string set for O(1) lookup
    const lockedSlotStarts = new Set(activeLocks.map((l) => l.slotStart.toISOString()))

    const slots: TimeSlot[] = []

    for (const window of windows) {
      const windowStart = toUtcTimestamp(window.date, window.startTime, window.timezone)
      const windowEnd = toUtcTimestamp(window.date, window.endTime, window.timezone)

      // Window duration check — service fit hogi?
      const windowDurationMs = windowEnd.getTime() - windowStart.getTime()
      if (windowDurationMs < durationMs) continue

      let current = new Date(windowStart)

      while (current.getTime() + durationMs <= windowEnd.getTime()) {
        const slotStart = new Date(current)
        const slotEnd = new Date(current.getTime() + durationMs)

        // Existing bookings se overlap check karo
        const isBooked = existingBookings.some((booking) => {
          const bookingStart = new Date(booking.scheduledAt)
          const bookingEnd = new Date(booking.endsAt)
          return slotStart < bookingEnd && slotEnd > bookingStart
        })

        // Past slots available nahi honge
        const isPast = slotStart < new Date()

        // Soft lock — kisi aur ne 10 min ke liye reserve kar rakha hai
        const softLocked = lockedSlotStarts.has(slotStart.toISOString())

        slots.push({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          available: !isBooked && !isPast,
          softLocked,
        })

        // Next slot
        current = slotEnd
      }
    }

    // Chronologically sort karo (alag windows se aaye slots mixed ho sakte hain)
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime))

    return slots
  }
}