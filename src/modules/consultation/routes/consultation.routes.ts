import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate, requireRole } from '@/modules/auth'

import { ServiceRepository } from '../repositories/service.repository'
import { AvailabilityRepository } from '../repositories/availability.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { ServiceRequestRepository } from '../repositories/service-request.repository'

import { ConsultationService } from '../services/consultation.service'
import { BookingService } from '../services/booking.service'
import { ServiceRequestService } from '../services/service-request.service'
import { AgoraService } from '../services/agora.service'
import { PushNotificationService } from '@/core/services/push-notification.service'

import {
  AstrologerConsultationController,
  UserConsultationController,
} from '../controllers/astrologer-consultation.controller'
import { BookingController } from '../controllers/booking.controller'
import { ServiceRequestController } from '../controllers/service-request.controller'

export async function consultationRoutes(app: FastifyInstance) {
  const db = getDb()

  // ─── Repositories ────────────────────────────────────────────────────────
  const serviceRepo = new ServiceRepository(db)
  const availabilityRepo = new AvailabilityRepository(db)
  const appointmentRepo = new AppointmentRepository(db)
  const serviceRequestRepo = new ServiceRequestRepository(db)

  // ─── Services ────────────────────────────────────────────────────────────
  const agoraService = new AgoraService()
  const pushNotificationService = new PushNotificationService(db)
  const consultationService = new ConsultationService(
    serviceRepo,
    availabilityRepo,
    appointmentRepo,
  )
  const bookingService = new BookingService(
    appointmentRepo,
    consultationService,
    agoraService,
    pushNotificationService,
  )
  const serviceRequestService = new ServiceRequestService(serviceRequestRepo, appointmentRepo)

  // ─── Controllers ─────────────────────────────────────────────────────────
  const astroController = new AstrologerConsultationController(consultationService, bookingService)
  const userController = new UserConsultationController(consultationService)
  const bookingController = new BookingController(bookingService)
  const srController = new ServiceRequestController(serviceRequestService)

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTROLOGER ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // Services
  app.post(
    '/consultation/services',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.createService,
  )

  app.patch(
    '/consultation/services/:id',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.updateService,
  )

  app.get(
    '/consultation/services/mine',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.getMyServices,
  )

  app.delete(
    '/consultation/services/:id',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.deactivateService,
  )

  // Ek variant ka price edit — astrologer khud ki service ke liye hi
  app.patch(
    '/consultation/services/:serviceId/variants/:variantId',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
      schema: {
        params: {
          type: 'object',
          properties: { serviceId: { type: 'string' }, variantId: { type: 'string' } },
        },
      },
    },
    astroController.updateServiceVariant,
  )

  // Availability
  app.post(
    '/consultation/availability',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.setAvailability,
  )

  app.get(
    '/consultation/availability/mine',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.getMyAvailability,
  )

  app.delete(
    '/consultation/availability/:id',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.deleteAvailability,
  )

  // Schedule
  app.get(
    '/consultation/schedule',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.getSchedule,
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // USER ROUTES (public + authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // Astrologer ki services dekho
  app.get(
    '/consultation/astrologers/:id/services',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    userController.getAstrologerServices,
  )

  // Ek service ke 5 duration variants — user detail page variant-selector
  app.get(
    '/consultation/services/:id/variants',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    userController.getServiceVariants,
  )

  // Astrologer ke available dates
  app.get(
    '/consultation/astrologers/:id/available-dates',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    userController.getAvailableDates,
  )

  // Available slots — MAIN BOOKING ROUTE
  // GET /consultation/slots?astrologerId=X&serviceId=Y&date=YYYY-MM-DD
  app.get('/consultation/slots', userController.getSlots)

  // Explore category detail page — kisi bhi astrologer ki us tag wali services
  // GET /consultation/services/browse?tag=X&limit=&offset=
  app.get('/consultation/services/browse', userController.browseByTag)

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING ROUTES (authenticated)
  // ═══════════════════════════════════════════════════════════════════════════

  // Initiate booking (pending — payment abhi baki)
  app.post(
    '/consultation/appointments/initiate',
    {
      preHandler: [authenticate],
    },
    bookingController.initiateBooking,
  )

  // My appointments
  app.get(
    '/consultation/appointments/mine',
    {
      preHandler: [authenticate],
    },
    bookingController.getMyAppointments,
  )

  // Single appointment
  app.get(
    '/consultation/appointments/:id',
    {
      preHandler: [authenticate],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    bookingController.getAppointmentById,
  )

  // Cancel
  app.patch(
    '/consultation/appointments/:id/cancel',
    {
      preHandler: [authenticate],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    bookingController.cancelAppointment,
  )

  // Join session → Agora token
  app.post(
    '/consultation/appointments/:id/join',
    {
      preHandler: [authenticate],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    bookingController.joinSession,
  )

  // End session (astrologer only)
  app.post(
    '/consultation/appointments/:id/end',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    bookingController.endSession,
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE REQUEST ROUTES (mid-session upsell)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post(
    '/consultation/service-requests',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    srController.createRequest,
  )

  app.patch(
    '/consultation/service-requests/:id',
    {
      preHandler: [authenticate],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    srController.respondToRequest,
  )

  app.get(
    '/consultation/service-requests/mine',
    {
      preHandler: [authenticate],
    },
    srController.getMyRequests,
  )
}
