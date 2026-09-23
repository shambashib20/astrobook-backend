import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'

import { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import { PaymentController } from '../controllers/payment.controller'
import { PaymentService } from '../service/payment.service'
import { PaymentRepository } from '../repositories/payment.repositary'
import { PushNotificationService } from '@/core/services/push-notification.service'

export async function paymentRoutes(app: FastifyInstance) {
  const db = getDb()

  const paymentRepo = new PaymentRepository(db)
  const appointmentRepo = new AppointmentRepository(db)
  const pushNotificationService = new PushNotificationService(db)
  const paymentService = new PaymentService(paymentRepo, appointmentRepo, pushNotificationService)
  const paymentController = new PaymentController(paymentService)

  // POST /payments/create-order
  app.post(
    '/payments/create-order',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Payment'],
        summary: 'Create Razorpay order for an appointment',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['appointmentId'],
          properties: {
            appointmentId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              orderId: { type: 'string' },
              amount: { type: 'number' },
              currency: { type: 'string' },
              appointmentId: { type: 'string' },
            },
          },
        },
      },
    },
    paymentController.createOrder,
  )

  // POST /payments/verify
  app.post(
    '/payments/verify',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Payment'],
        summary: 'Verify Razorpay payment → confirm appointment + generate Agora token',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['appointmentId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature'],
          properties: {
            appointmentId: { type: 'string', format: 'uuid' },
            razorpayOrderId: { type: 'string' },
            razorpayPaymentId: { type: 'string' },
            razorpaySignature: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              appointment: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    paymentController.verifyPayment,
  )

  // GET /payments/transactions
  app.get(
    '/payments/transactions',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Payment'],
        summary: 'Astrologer ke apne received payments (transactions list)',
        security: [{ bearerAuth: [] }],
      },
    },
    paymentController.getMyTransactions,
  )

  // ── Cashfree return/webhook routes (commented out during the Razorpay
  // rollback — kept, not deleted, for a quick re-migration) ──
  // app.get('/payments/cashfree-return', ...)
  // await app.register(async (webhookApp) => { ... POST /payments/webhooks/cashfree ... })
}
