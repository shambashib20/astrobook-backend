// Razorpay orders/checkout — commented out during the Cashfree migration
// (kept, not deleted, for a quick rollback):
// import Razorpay from 'razorpay'
// import crypto from 'crypto'
// const razorpay = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET })

import { env } from '@/config/env'
import { BadRequestError, NotFoundError, ForbiddenError } from '@/core/errors'
import { AgoraService } from '@/modules/consultation/services/agora.service'
import { createOrder as cfCreateOrder, getOrder as cfGetOrder } from '@/core/services/cashfree-order.service'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { PaymentRepository } from '../repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type {
  CreatePaymentOrderDto,
  VerifyPaymentDto,
} from '@/modules/consultation/schemas/consultation.schema'

export class PaymentService {
  private readonly agoraService = new AgoraService()

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  // Step 1: Create Cashfree order (with the astrologer's split baked in)
  async createOrder(userId: string, dto: CreatePaymentOrderDto) {
    const { appointmentId } = dto

    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== userId) {
      throw ForbiddenError('You are not authorized to pay for this appointment')
    }

    if (appointment.status !== 'pending') {
      throw BadRequestError('Appointment is not in pending state')
    }

    // Get service price from appointment
    const appointmentWithDetails =
      await this.appointmentRepository.findByIdWithDetails(appointmentId)
    if (!appointmentWithDetails) throw NotFoundError('Appointment details not found')

    // Booking waqt ka price snapshot use karo (variant-based) — agar kisi
    // wajah se null hai (purani appointment) toh service.price pe fallback
    const amount = Number(appointmentWithDetails.price ?? appointmentWithDetails.service.price)
    if (!amount || amount <= 0) throw BadRequestError('Invalid service price')

    // Astrologer's live commissionPercentage + Cashfree vendor id — read
    // fresh every time (admin can change commission mid-day; this order
    // must reflect whatever is current right now, not a cached value).
    const payoutInfo = await this.paymentRepository.getAstrologerPayoutInfo(appointment.astrologerId)
    if (!payoutInfo?.cashfreeVendorId) {
      throw BadRequestError(
        'This astrologer has not completed payout onboarding yet — booking cannot be paid for',
      )
    }
    const commissionPercentage = Number(payoutInfo.commissionPercentage)
    const astrologerSplitPercentage = 100 - commissionPercentage
    const astrologerPayoutAmount = Math.round(amount * astrologerSplitPercentage) / 100

    const customer = await this.paymentRepository.getCustomerDetails(userId)
    if (!customer) throw NotFoundError('User not found')

    // Cashfree requires a caller-chosen order_id (unlike Razorpay, which
    // handed back its own) — unique per attempt so a retry after a failed
    // payment doesn't collide with the earlier order.
    const orderId = `ord_${appointmentId.slice(0, 8)}_${Date.now().toString(36)}`

    const order = await cfCreateOrder({
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: userId,
        customer_email: customer.email ?? 'no-reply@astrobook.app',
        customer_phone: customer.phone ?? '9999999999',
        customer_name: customer.name ?? 'Astrobook User',
      },
      order_note: `Appointment ${appointmentId}`,
      order_splits: [{ vendor_id: payoutInfo.cashfreeVendorId, percentage: astrologerSplitPercentage }],
      order_meta: {
        // NOTE: payment routes are registered under /api/${env.API_VERSION}
        // (see app.ts) — must match exactly or Cashfree calls a 404 and
        // both the webhook and the OTP/3DS return redirect silently fail.
        notify_url: `${env.BACKEND_PUBLIC_URL}/api/${env.API_VERSION}/payments/webhooks/cashfree`,
        // {order_id} is a Cashfree-recognised placeholder — it substitutes
        // the real order id when redirecting the browser back here after
        // the issuing bank's OTP/3DS page finishes. Required for the
        // hosted card checkout flow (doWebPayment) — without it, the OTP
        // step has nowhere to redirect to and the SDK reports a generic
        // "Payment error" even though the card details were valid.
        return_url: `${env.BACKEND_PUBLIC_URL}/api/${env.API_VERSION}/payments/cashfree-return?order_id={order_id}`,
      },
    })

    // Save payment record as pending — the split actually used is snapshotted
    // here (platformCommissionPercentage/astrologerPayoutAmount) so a later
    // admin commission change never rewrites this order's history.
    await this.paymentRepository.create({
      appointmentId,
      cashfreeOrderId: order.order_id,
      amount: String(amount),
      status: 'pending',
      platformCommissionPercentage: String(commissionPercentage),
      astrologerPayoutAmount: String(astrologerPayoutAmount),
    })

    return {
      orderId: order.order_id,
      paymentSessionId: order.payment_session_id,
      amount,
      currency: 'INR',
      appointmentId,
    }
  }

  // Step 2: Confirm payment → appointment + Agora token. Authoritative
  // confirmation happens server-side via the Cashfree webhook
  // (finalizeOrderPayments below, called from the webhook route) — this
  // just re-reads current status, falling back to a live Cashfree status
  // check if the webhook hasn't landed yet by the time the client asks.
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const { appointmentId } = dto

    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== userId) {
      throw ForbiddenError('You are not authorized to verify this payment')
    }

    const payment = await this.paymentRepository.findByAppointmentId(appointmentId)
    if (!payment?.cashfreeOrderId) throw NotFoundError('No payment found for this appointment')

    if (payment.status !== 'success') {
      const order = await cfGetOrder(payment.cashfreeOrderId)
      if (order.order_status === 'PAID') {
        await this.finalizeOrderPayments(payment.cashfreeOrderId, String(order.cf_order_id))
      } else if (order.order_status === 'EXPIRED' || order.order_status === 'TERMINATED') {
        await this.paymentRepository.updateByOrderId(payment.cashfreeOrderId, { status: 'failed' })
        throw BadRequestError('Payment did not complete')
      } else {
        return { message: 'Payment still processing', appointment }
      }
    }

    const confirmed = await this.appointmentRepository.findById(appointmentId)
    return { message: 'Payment successful', appointment: confirmed }
  }

  // Called from the Cashfree webhook route (authoritative confirmation
  // path) and as a fallback from verifyPayment above. Idempotent — safe to
  // call more than once for the same order (e.g. a webhook retry landing
  // after verifyPayment's fallback already confirmed it).
  async finalizeOrderPayments(cashfreeOrderId: string, cashfreePaymentId: string) {
    const paymentRows = await this.paymentRepository.findAllByOrderId(cashfreeOrderId)

    await Promise.all(
      paymentRows.map(async (row) => {
        if (row.status === 'success') return // already finalized

        await this.paymentRepository.updateByOrderId(cashfreeOrderId, {
          status: 'success',
          cashfreePaymentId,
        })

        const appointment = await this.appointmentRepository.findById(row.appointmentId)
        if (!appointment) return

        const { channel, token } = this.agoraService.generateToken(appointment.id)
        await this.appointmentRepository.update(appointment.id, {
          status: 'confirmed',
          agoraChannel: channel,
          agoraToken: token,
        })

        this.pushNotificationService.sendToUser(appointment.userId, {
          title: 'Booking Confirmed!',
          body: 'Tumhari booking confirm ho gayi hai',
          data: { type: 'booking_confirmed', appointmentId: appointment.id },
        })
        this.pushNotificationService.sendToUser(appointment.astrologerId, {
          title: 'Naya Booking Mila',
          body: `₹${row.amount} ka payment mila — naya booking confirm ho gaya`,
          data: { type: 'new_booking', appointmentId: appointment.id },
        })
      }),
    )
  }

  // Astrologer ke apne received payments (transactions tab ke liye)
  async getAstrologerTransactions(astrologerId: string) {
    return this.paymentRepository.findByAstrologer(astrologerId)
  }
}
