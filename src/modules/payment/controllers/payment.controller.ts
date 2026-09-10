import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PaymentService } from '../service/payment.service'
import { verifyWebhookSignature } from '@/core/services/cashfree-order.service'
import { BadRequestError } from '@/core/errors'
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

  // POST /payments/webhooks/cashfree — authoritative payment confirmation.
  // Public route (no user auth — Cashfree is the caller), protected instead
  // by the HMAC signature check. Requires the RAW request body (see the raw
  // content-type parser registered around this route in payment.routes.ts)
  // — reformatted JSON would fail the signature check even for a genuine
  // webhook. Payload shape (type/data.order/data.payment field names)
  // should be confirmed against a real sandbox test webhook before go-live.
  cashfreeWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (request as unknown as { rawBody?: string }).rawBody
    const timestamp = request.headers['x-webhook-timestamp'] as string | undefined
    const signature = request.headers['x-webhook-signature'] as string | undefined

    if (!rawBody || !timestamp || !signature || !verifyWebhookSignature(rawBody, timestamp, signature)) {
      throw BadRequestError('Invalid Cashfree webhook signature')
    }

    const payload = request.body as {
      type?: string
      data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string; payment_status?: string } }
    }

    // cf_payment_id is a 19-digit id — beyond Number.MAX_SAFE_INTEGER. If
    // Cashfree sends it as an unquoted JSON number (it does), the standard
    // JSON.parse used by our raw-body content-type parser already rounds it
    // to the nearest representable double before this code ever runs — e.g.
    // 1451711055512987648 silently becomes 1451711055512987600. Pull it
    // straight out of the raw string instead, so it's never coerced through
    // a JS number.
    const cfPaymentIdMatch = rawBody.match(/"cf_payment_id"\s*:\s*"?(\d+)"?/)
    const cfPaymentId = cfPaymentIdMatch?.[1] ?? String(payload?.data?.payment?.cf_payment_id ?? '')

    if (payload?.data?.payment?.payment_status === 'SUCCESS' && payload.data.order?.order_id) {
      await this.paymentService.finalizeOrderPayments(payload.data.order.order_id, cfPaymentId)
    }

    return reply.status(200).send({ received: true })
  }
}
