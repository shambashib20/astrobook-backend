import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'

import { CartRepository } from '../repositories/cart.repository'
import { ServiceRepository } from '@/modules/consultation/repositories/service.repository'
import { AvailabilityRepository } from '@/modules/consultation/repositories/availability.repository'
import { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'

import { ConsultationService } from '@/modules/consultation/services/consultation.service'
import { BookingService } from '@/modules/consultation/services/booking.service'
import { AgoraService } from '@/modules/consultation/services/agora.service'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { CartService } from '../services/cart.service'

import { CartController } from '../controllers/cart.controller'

export async function cartRoutes(app: FastifyInstance) {
  const db = getDb()

  const cartRepo = new CartRepository(db)
  const serviceRepo = new ServiceRepository(db)
  const availabilityRepo = new AvailabilityRepository(db)
  const appointmentRepo = new AppointmentRepository(db)
  const paymentRepo = new PaymentRepository(db)

  const agoraService = new AgoraService()
  const pushNotificationService = new PushNotificationService(db)
  const consultationService = new ConsultationService(serviceRepo, availabilityRepo, appointmentRepo)
  const bookingService = new BookingService(
    appointmentRepo,
    consultationService,
    agoraService,
    pushNotificationService,
    paymentRepo,
  )

  const cartService = new CartService(
    cartRepo,
    serviceRepo,
    paymentRepo,
    appointmentRepo,
    bookingService,
    agoraService,
    pushNotificationService,
  )
  const cartController = new CartController(cartService)

  // POST /cart/items — cart mein add karo
  app.post('/cart/items', { preHandler: [authenticate] }, cartController.addItem)

  // GET /cart — apna poora cart (service details enriched)
  app.get('/cart', { preHandler: [authenticate] }, cartController.getMyCart)

  // PATCH /cart/items/:id/slot — is item ka slot set karo
  app.patch('/cart/items/:id/slot', { preHandler: [authenticate] }, cartController.setSlot)

  // DELETE /cart/items/:id — cart se hatao
  app.delete('/cart/items/:id', { preHandler: [authenticate] }, cartController.removeItem)

  // POST /cart/checkout/create-order — selected items ka ek combined Razorpay order
  app.post(
    '/cart/checkout/create-order',
    { preHandler: [authenticate] },
    cartController.createCheckoutOrder,
  )

  // POST /cart/checkout/verify — payment verify + saari appointments confirm
  app.post(
    '/cart/checkout/verify',
    { preHandler: [authenticate] },
    cartController.verifyCheckout,
  )
}
