import crypto from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PaymentService } from '../service/payment.service'
import { env } from '@/config/env'
import {
  CreatePaymentOrderSchema,
  VerifyPaymentSchema,
} from '@/modules/consultation/schemas/consultation.schema'

export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  createOrder = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const dto = CreatePaymentOrderSchema.parse(request.body)

    const order = await this.paymentService.createOrder(userId, dto)
    return reply.status(201).send(order)
  }

  verifyPayment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const dto = VerifyPaymentSchema.parse(request.body)

    const result = await this.paymentService.verifyPayment(userId, dto)
    return reply.status(200).send(result)
  }

  // GET /payments/transactions — astrologer ke apne received payments
  getMyTransactions = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const transactions = await this.paymentService.getAstrologerTransactions(userId)
    return reply.status(200).send({ success: true, data: { transactions } })
  }

  // POST /payments/webhooks/razorpay — Razorpay se server-to-server call,
  // koi user auth nahi (isliye route pe `authenticate` preHandler nahi hai).
  // Security signature verification se aata hai, JWT se nahi.
  razorpayWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      request.log.warn('Razorpay webhook hit but RAZORPAY_WEBHOOK_SECRET set nahi hai — skipping')
      return reply.status(501).send({ message: 'Webhook not configured' })
    }

    const signature = request.headers['x-razorpay-signature'] as string | undefined
    const rawBody = (request as any).rawBody as string | undefined
    if (!signature || !rawBody) {
      return reply.status(400).send({ message: 'Missing signature or body' })
    }

    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex')

    if (expectedSignature !== signature) {
      request.log.warn('Razorpay webhook signature mismatch')
      return reply.status(400).send({ message: 'Invalid signature' })
    }

    const event = request.body as {
      event: string
      payload?: { payment?: { entity?: { order_id?: string; id?: string } } }
    }

    const entity = event.payload?.payment?.entity
    const orderId = entity?.order_id
    const paymentId = entity?.id

    // Razorpay ko turant 200 chahiye (warna wo retry karta rehta hai) — asli
    // kaam ke fail hone se bhi webhook ko fail mat karne do, warna Razorpay
    // usi event ko baar-baar retry karega. Errors yahan sirf log hote hain.
    try {
      if (event.event === 'payment.captured' && orderId && paymentId) {
        await this.paymentService.finalizeOrderByWebhook(orderId, paymentId)
      } else if (event.event === 'payment.failed' && orderId) {
        await this.paymentService.markOrderFailedByWebhook(orderId, paymentId)
      }
    } catch (err) {
      request.log.error(err, 'Razorpay webhook processing failed')
    }

    return reply.status(200).send({ received: true })
  }

  // ── Cashfree webhook (commented out during the Razorpay rollback — kept,
  // not deleted, for a quick re-migration) ──
  // cashfreeWebhook = async (request: FastifyRequest, reply: FastifyReply) => { ... }
}
