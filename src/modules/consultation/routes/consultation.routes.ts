import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate, requireRole } from '@/modules/auth'

import { ServiceRepository } from '../repositories/service.repository'
import { AvailabilityRepository } from '../repositories/availability.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { RecurringAvailabilityRepository } from '../repositories/recurring-availability.repository'
import { SlotLockRepository } from '../repositories/slot-lock.repository'
import { ServiceRequestRepository } from '../repositories/service-request.repository'
import { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import { WalletRepository } from '@/modules/wallet/repositories/wallet.repository'

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
  const recurringAvailabilityRepo = new RecurringAvailabilityRepository(db)
  const slotLockRepo = new SlotLockRepository(db)
  const serviceRequestRepo = new ServiceRequestRepository(db)
  const paymentRepo = new PaymentRepository(db)
  const walletRepo = new WalletRepository(db)

  // ─── Services ────────────────────────────────────────────────────────────
  const agoraService = new AgoraService()
  const pushNotificationService = new PushNotificationService(db)
  const consultationService = new ConsultationService(
    serviceRepo,
    availabilityRepo,
    appointmentRepo,
    recurringAvailabilityRepo,
    slotLockRepo,
  )
  const bookingService = new BookingService(
    appointmentRepo,
    consultationService,
    agoraService,
    pushNotificationService,
    paymentRepo,
    walletRepo,
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

  // Recurring Availability
  app.post(
    '/consultation/availability/recurring',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.setRecurringAvailability,
  )

  app.get(
    '/consultation/availability/recurring/mine',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
    },
    astroController.getMyRecurringAvailability,
  )

  app.delete(
    '/consultation/availability/recurring/:id',
    {
      preHandler: [authenticate, requireRole(['astrologer', 'admin'])],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    astroController.deleteRecurringAvailability,
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

  // Slot Locks — Book My Show style soft reservation
  // POST /consultation/slots/lock
  app.post(
    '/consultation/slots/lock',
    {
      preHandler: [authenticate],
    },
    userController.lockSlot,
  )

  // DELETE /consultation/slots/lock — ek specific slot release karo
  app.delete(
    '/consultation/slots/lock',
    {
      preHandler: [authenticate],
    },
    userController.releaseSlot,
  )

  // DELETE /consultation/slots/lock/all — user ke saare locks release karo (page close / logout)
  app.delete(
    '/consultation/slots/lock/all',
    {
      preHandler: [authenticate],
    },
    userController.releaseAllLocks,
  )

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

  // Renew Agora token — 1 hour expiry se pehle app khud call karta hai
  // (onTokenPrivilegeWillExpire), taaki lambe (90-min) sessions beech mein
  // na katein
  app.post(
    '/consultation/appointments/:id/renew-token',
    {
      preHandler: [authenticate],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    bookingController.renewAgoraToken,
  )

  // Reschedule — user ne cancel ke baad naya slot choose kiya
  // Same astrologer, same service, same price, 1/booking + 1/week + 2/month limit
  app.patch(
    '/consultation/appointments/:id/reschedule',
    {
      preHandler: [authenticate],
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['newScheduledAt'],
          properties: {
            newScheduledAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    bookingController.rescheduleAppointment,
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