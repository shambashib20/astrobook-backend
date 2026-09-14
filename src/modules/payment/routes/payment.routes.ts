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
        summary: 'Create a split Cashfree order for an appointment',
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
              paymentSessionId: { type: 'string' },
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

  // POST /payments/verify — status re-read; authoritative confirmation
  // happens via the webhook route below. No signature fields anymore —
  // Cashfree's hosted checkout doesn't hand the client one.
  app.post(
    '/payments/verify',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Payment'],
        summary: 'Check Cashfree payment status → confirm appointment + generate Agora token',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['appointmentId'],
          properties: {
            appointmentId: { type: 'string', format: 'uuid' },
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

  // GET /payments/cashfree-return — order_meta.return_url target. The
  // native SDK (doWebPayment) intercepts this navigation client-side to
  // detect that the bank's OTP/3DS page finished and fires onVerify/onError
  // itself, so this handler rarely actually renders — but it needs to
  // resolve to *something* (not a 404) for the brief moment before the SDK
  // intercepts, and as a fallback if interception fails for any reason.
  app.get(
    '/payments/cashfree-return',
    { schema: { tags: ['Payment'], summary: 'Cashfree hosted-checkout return landing page' } },
    async (_request, reply) => {
      return reply.type('text/html').send('<html><body>Processing payment…</body></html>')
    },
  )

  // POST /payments/webhooks/cashfree — Cashfree calls this, not a logged-in
  // user, so: no `authenticate` preHandler, an explicit rate-limit
  // exemption (the global limiter is keyed for per-user traffic and would
  // throttle Cashfree's retries), and a route-scoped raw-body content-type
  // parser (signature verification needs the exact bytes Cashfree sent —
  // Fastify's default JSON parser discards that by parsing into an object).
  // Scoping addContentTypeParser inside this nested `register` keeps every
  // other route in the app on the default JSON parser (Fastify encapsulates
  // parsers per-plugin-context).
  await app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (req, body, done) => {
        ;(req as unknown as { rawBody: string }).rawBody = body as string
        try {
          done(null, JSON.parse(body as string))
        } catch (err) {
          done(err as Error, undefined)
        }
      },
    )

    webhookApp.post(
      '/payments/webhooks/cashfree',
      {
        config: { rateLimit: false },
        schema: {
          tags: ['Payment'],
          summary: 'Cashfree payment webhook — authoritative order confirmation',
        },
      },
      paymentController.cashfreeWebhook,
    )
  })
}
