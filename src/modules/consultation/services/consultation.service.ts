import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { ServiceRepository } from '../repositories/service.repository'
import type { AvailabilityRepository } from '../repositories/availability.repository'
import type { AppointmentRepository } from '../repositories/appointment.repository'
import type {
  CreateServiceDto,
  UpdateServiceDto,
  CreateAvailabilityDto,
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
}

// ─── ConsultationService ──────────────────────────────────────────────────────

export class ConsultationService {
  constructor(
    private readonly serviceRepository: ServiceRepository,
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly appointmentRepository: AppointmentRepository,
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
    const variant = await this.serviceRepository.findDefaultVariant(serviceId)
    if (!variant) throw NotFoundError('Default variant not found for this service')
    return variant
  }

  // Helper — services list ke saath unke variants attach karo (N+1 avoid
  // karne ke liye ek hi query se saare variants fetch karke group karte hain)
  private async attachVariants<T extends { id: string }>(
    services: T[],
  ): Promise<(T & { variants: Awaited<ReturnType<ServiceRepository['findVariantsByService']>> })[]> {
    if (services.length === 0) return []
    const allVariants = await Promise.all(
      services.map((s) => this.serviceRepository.findVariantsByService(s.id)),
    )
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

  // ── User: Available Dates ──────────────────────────────────────────────────

  async getAvailableDates(astrologerId: string): Promise<string[]> {
    const windows = await this.availabilityRepository.findUpcomingByAstrologer(astrologerId)
    // Ek din ke multiple windows ho sakte hain (11-1pm, 3-5pm, 8-10pm) —
    // isliye Set se unique dates nikalo, warna same date UI mein double dikhta hai
    const uniqueDates = Array.from(new Set(windows.map((w) => w.date)))
    return uniqueDates
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
      : await this.serviceRepository.findDefaultVariant(serviceId)
    if (!variant || variant.serviceId !== serviceId) {
      throw BadRequestError('Variant does not belong to the specified service')
    }

    // Us din ke saare availability windows fetch karo
    const windows = await this.availabilityRepository.findAllByDate(astrologerId, date)
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

        slots.push({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          available: !isBooked && !isPast,
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
