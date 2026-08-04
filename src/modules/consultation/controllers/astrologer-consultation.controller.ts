import type { FastifyRequest, FastifyReply } from 'fastify'
import type { ConsultationService } from '../services/consultation.service'
import type { BookingService } from '../services/booking.service'
import {
  CreateServiceSchema,
  UpdateServiceSchema,
  UpdateServiceVariantSchema,
  CreateAvailabilitySchema,
  GetSlotsQuerySchema,
  BrowseServicesQuerySchema,
} from '../schemas/consultation.schema'

export class AstrologerConsultationController {
  constructor(
    private readonly consultationService: ConsultationService,
    private readonly bookingService: BookingService,
  ) {}

  // POST /consultation/services — astrologer khud ki nayi "normal" service
  createService = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const dto = CreateServiceSchema.parse(request.body)
    const service = await this.consultationService.createService(astrologerId, dto)
    return reply.status(201).send({ success: true, data: { service } })
  }

  // PATCH /consultation/services/:id — kisi bhi service ka edit (Basic ya normal)
  updateService = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    const dto = UpdateServiceSchema.parse(request.body)
    const service = await this.consultationService.updateService(id, astrologerId, dto)
    return reply.status(200).send({ success: true, data: { service } })
  }

  // GET /consultation/services/mine
  getMyServices = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const services = await this.consultationService.getMyServices(astrologerId)
    return reply.status(200).send({ success: true, data: { services } })
  }

  // DELETE /consultation/services/:id
  deactivateService = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.consultationService.deactivateService(id, astrologerId)
    return reply.status(200).send({ success: true })
  }

  // PATCH /consultation/services/:serviceId/variants/:variantId — astrologer
  // sirf ek variant ka price edit karta hai (duration fixed hai)
  updateServiceVariant = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const { serviceId, variantId } = request.params as { serviceId: string; variantId: string }
    const { price } = UpdateServiceVariantSchema.parse(request.body)
    const variant = await this.consultationService.updateServiceVariant(
      serviceId,
      variantId,
      astrologerId,
      price,
    )
    return reply.status(200).send({ success: true, data: { variant } })
  }

  // POST /consultation/availability
  setAvailability = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const dto = CreateAvailabilitySchema.parse(request.body)
    const availability = await this.consultationService.setAvailability(astrologerId, dto)
    return reply.status(201).send({ success: true, data: { availability } })
  }

  // GET /consultation/availability/mine
  getMyAvailability = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const availability = await this.consultationService.getMyAvailability(astrologerId)
    return reply.status(200).send({ success: true, data: { availability } })
  }

  // DELETE /consultation/availability/:id
  deleteAvailability = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.consultationService.deleteAvailability(id, astrologerId)
    return reply.status(204).send()
  }

  // GET /consultation/schedule
  getSchedule = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: astrologerId } = request.user as { userId: string }
    const { date } = request.query as { date?: string }
    const today = date ?? new Date().toISOString().split('T')[0]!
    const schedule = await this.bookingService.getSchedule(astrologerId, today)
    return reply.status(200).send({ success: true, data: { date: today, schedule } })
  }
}

// ─── User-facing Consultation Controller ─────────────────────────────────────

export class UserConsultationController {
  constructor(private readonly consultationService: ConsultationService) {}

  // GET /consultation/astrologers/:id/services
  getAstrologerServices = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: astrologerId } = request.params as { id: string }
    const services = await this.consultationService.getAstrologerServices(astrologerId)
    return reply.status(200).send({ success: true, data: { services } })
  }

  // GET /consultation/slots?astrologerId=X&serviceId=Y&variantId=Z&date=YYYY-MM-DD
  getSlots = async (request: FastifyRequest, reply: FastifyReply) => {
    const { astrologerId, serviceId, variantId, date } = GetSlotsQuerySchema.parse(request.query)
    const slots = await this.consultationService.getAvailableSlots(
      astrologerId,
      serviceId,
      date,
      variantId,
    )
    return reply.status(200).send({ success: true, data: { slots } })
  }

  // GET /consultation/services/:id/variants — service ke 5 duration variants
  // (user detail page ka variant-selector isi se aata hai)
  getServiceVariants = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: serviceId } = request.params as { id: string }
    const variants = await this.consultationService.getServiceVariants(serviceId)
    return reply.status(200).send({ success: true, data: { variants } })
  }

  // GET /consultation/astrologers/:id/available-dates
  getAvailableDates = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: astrologerId } = request.params as { id: string }
    const dates = await this.consultationService.getAvailableDates(astrologerId)
    return reply.status(200).send({ success: true, data: { dates } })
  }

  // GET /consultation/services/browse?tag=X&limit=&offset= — Explore category
  // detail page ke "Consultancies" section (kisi bhi astrologer ki services)
  browseByTag = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tag, limit, offset } = BrowseServicesQuerySchema.parse(request.query)
    const services = await this.consultationService.browseServicesByTag(tag, limit, offset)
    const hasMore = services.length === limit
    return reply.status(200).send({ success: true, data: { services, hasMore } })
  }
}
