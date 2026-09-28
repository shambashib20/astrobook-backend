import Razorpay from 'razorpay'
import crypto from 'crypto'
import { env } from '@/config/env'
import { BadRequestError, NotFoundError, ForbiddenError } from '@/core/errors'
import { MISSED_SESSION_GRACE_MS } from '@/core/utils/cron-heartbeat'
import { AgoraService } from '@/modules/consultation/services/agora.service'
// Cashfree split-order checkout — commented out during the Razorpay
// rollback (kept, not deleted, for a quick re-migration):
// import { createOrder as cfCreateOrder, getOrder as cfGetOrder } from '@/core/services/cashfree-order.service'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { PaymentRepository } from '../repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type {
  CreatePaymentOrderDto,
  VerifyPaymentDto,
} from '@/modules/consultation/schemas/consultation.schema'

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
})

export class PaymentService {
  private readonly agoraService = new AgoraService()

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  // Cron ne stale-pending samajh ke booking cancel kar di, lekin payment
  // asal mein ho chuka nikla (paisa capture ho chuka Razorpay ke paas) —
  // Slot abhi bhi free hai ya kisi aur ne le liya, check karo.
  // Free hai → true (aage safe hai re-confirm karna).
  // Kisi aur ne le liya → refund trigger karke false (aage confirm mat karo).
  private async resolveCancelledConflict(
    appointment: NonNullable<Awaited<ReturnType<AppointmentRepository['findById']>>>,
    razorpayPaymentId: string,
  ): Promise<boolean> {
    const conflicts = await this.appointmentRepository.findConfirmedByAstrologerInRange(
      appointment.astrologerId,
      appointment.scheduledAt,
      appointment.endsAt,
    )
    const hasRealConflict = conflicts.some((c) => c.id !== appointment.id)

    if (!hasRealConflict) return true // slot abhi bhi free hai, safe hai

    // Kisi aur ne slot le liya beech mein — refund karo, is appointment ko
    // cancelled hi rehne do
    try {
      await razorpay.payments.refund(razorpayPaymentId, {})
    } catch (err) {
      // Refund fail ho jaaye (network/Razorpay side issue) — kam se kam
      // appointment ko wrongly confirm nahi kiya, manually resolve karna
      // padega (payment record 'success' + appointment 'cancelled' dikhega,
      // jo ek clear flag hai admin ke liye)
    }
    this.pushNotificationService.sendToUser(appointment.userId, {
      title: 'Slot Ab Available Nahi Hai',
      body: 'Tumhara payment ho gaya tha lekin ye slot kisi aur ne le liya — poora refund process ho raha hai',
      data: { type: 'booking_conflict_refund', appointmentId: appointment.id },
    })
    return false
  }

  // Step 1: Create Razorpay order
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

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise mein
      currency: 'INR',
      receipt: `appt_${appointmentId.slice(0, 8)}`,
      notes: {
        appointmentId,
        userId,
      },
    })

    // Save payment record as pending
    await this.paymentRepository.create({
      appointmentId,
      razorpayOrderId: order.id,
      amount: String(amount),
      status: 'pending',
    })

    return {
      orderId: order.id,
      amount,
      currency: 'INR',
      appointmentId,
    }
  }

  // Step 2: Verify payment → confirm appointment + generate Agora token
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = dto

    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== userId) {
      throw ForbiddenError('You are not authorized to verify this payment')
    }

    // Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex')

    if (expectedSignature !== razorpaySignature) {
      // Mark payment as failed
      await this.paymentRepository.updateByOrderId(razorpayOrderId, {
        status: 'failed',
        razorpayPaymentId,
        razorpaySignature,
      })
      this.pushNotificationService.sendToUser(userId, {
        title: 'Payment Nahi Hua',
        body: 'Tumhara payment complete nahi ho paya',
        data: { type: 'payment_failed', appointmentId },
      })
      throw BadRequestError('Payment verification failed — invalid signature')
    }

    // Cron ne stale-pending samajh ke ye booking cancel kar di thi, lekin
    // payment asal mein ho chuka nikla — slot free hai ya nahi check karo
    // safely re-confirm karne se pehle
    if (appointment.status === 'cancelled') {
      const safe = await this.resolveCancelledConflict(appointment, razorpayPaymentId)
      if (!safe) {
        await this.paymentRepository.updateByOrderId(razorpayOrderId, {
          status: 'success',
          razorpayPaymentId,
          razorpaySignature,
        })
        throw BadRequestError(
          'Slot ab available nahi hai — tumhara refund process ho raha hai',
        )
      }
      // Slot free hai — appointment ko wapas 'confirmed' karke normal flow
      // continue hone do (neeche wala code Agora token generate karega)
    }

    // Webhook aksar isse pehle hi pahunch jaata hai (fast) aur appointment
    // confirm kar deta hai — dobara Agora token/notification mat bhejo,
    // sirf signature record karke current state wapas kar do.
    if (appointment.status === 'confirmed') {
      await this.paymentRepository.updateByOrderId(razorpayOrderId, {
        razorpayPaymentId,
        razorpaySignature,
      })
      return {
        message: 'Payment successful',
        appointment,
      }
    }

    // Generate Agora token now that payment is confirmed
    const { channel, token } = this.agoraService.generateToken(appointmentId)

    // Update payment record
    const updatedPayment = await this.paymentRepository.updateByOrderId(razorpayOrderId, {
      status: 'success',
      razorpayPaymentId,
      razorpaySignature,
    })

    // Confirm appointment + set Agora credentials
    const confirmed = await this.appointmentRepository.update(appointmentId, {
      status: 'confirmed',
      agoraChannel: channel,
      agoraToken: token,
    })

    // Dono taraf notify karo
    this.pushNotificationService.sendToUser(appointment.userId, {
      title: 'Booking Confirmed!',
      body: 'Tumhari booking confirm ho gayi hai',
      data: { type: 'booking_confirmed', appointmentId },
    })
    this.pushNotificationService.sendToUser(appointment.astrologerId, {
      title: 'Naya Booking Mila',
      body: `₹${updatedPayment?.amount ?? ''} ka payment mila — naya booking confirm ho gaya`,
      data: { type: 'new_booking', appointmentId },
    })

    return {
      message: 'Payment successful',
      appointment: confirmed,
    }
  }

  // ── Webhook (Razorpay-driven, signature already verified in the route) ──
  // Client-side verifyPayment() upar wala hi flow hai, lekin agar app
  // crash/network-drop ho jaaye payment success ke turant baad, verify call
  // kabhi backend tak pahunchti hi nahi — Razorpay ke paas paisa capture ho
  // chuka hota hai but appointment kabhi confirm nahi hoti. Webhook isi gap
  // ko cover karta hai, Razorpay ke server-to-server call se, independent
  // of app ka state. Ek hi orderId pe dono (client verify + webhook) fire ho
  // sakte hain — isliye har jagah "already done?" check karke skip karte hain.

  async finalizeOrderByWebhook(razorpayOrderId: string, razorpayPaymentId: string) {
    const paymentRows = await this.paymentRepository.findAllByOrderId(razorpayOrderId)
    if (paymentRows.length === 0) return // hamara order nahi (ya abhi tak create hi nahi hua)

    const pendingRows = paymentRows.filter((r) => r.status !== 'success')
    if (pendingRows.length === 0) return // client-side verify already jeet chuka — no-op

    await this.paymentRepository.updateByOrderId(razorpayOrderId, {
      status: 'success',
      razorpayPaymentId,
    })

    for (const row of pendingRows) {
      const appointment = await this.appointmentRepository.findById(row.appointmentId)
      // Appointment already confirmed ho chuki (race jeeti client-side verify
      // ne beech mein) — dobara Agora token/notification mat bhejo
      if (!appointment || appointment.status === 'confirmed') continue

      if (appointment.status === 'cancelled') {
        const safe = await this.resolveCancelledConflict(appointment, razorpayPaymentId)
        if (!safe) continue // refund ho chuka, is row ko confirm mat karo
        // Slot free hai — neeche wala code isse wapas confirm kar dega
      }

      const { channel, token } = this.agoraService.generateToken(row.appointmentId)
      await this.appointmentRepository.update(row.appointmentId, {
        status: 'confirmed',
        agoraChannel: channel,
        agoraToken: token,
      })

      this.pushNotificationService.sendToUser(appointment.userId, {
        title: 'Booking Confirmed!',
        body: 'Tumhari booking confirm ho gayi hai',
        data: { type: 'booking_confirmed', appointmentId: row.appointmentId },
      })
      this.pushNotificationService.sendToUser(appointment.astrologerId, {
        title: 'Naya Booking Mila',
        body: `₹${row.amount} ka payment mila — naya booking confirm ho gaya`,
        data: { type: 'new_booking', appointmentId: row.appointmentId },
      })
    }
  }

  async markOrderFailedByWebhook(razorpayOrderId: string, razorpayPaymentId?: string) {
    const paymentRows = await this.paymentRepository.findAllByOrderId(razorpayOrderId)
    const pendingRows = paymentRows.filter((r) => r.status === 'pending')
    if (pendingRows.length === 0) return

    await this.paymentRepository.updateByOrderId(razorpayOrderId, {
      status: 'failed',
      ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
    })

    for (const row of pendingRows) {
      const appointment = await this.appointmentRepository.findById(row.appointmentId)
      if (!appointment) continue
      this.pushNotificationService.sendToUser(appointment.userId, {
        title: 'Payment Nahi Hua',
        body: 'Tumhara payment complete nahi ho paya',
        data: { type: 'payment_failed', appointmentId: row.appointmentId },
      })
    }
  }

  // Astrologer ke apne received payments (transactions tab ke liye)
  async getAstrologerTransactions(astrologerId: string) {
    return this.paymentRepository.findByAstrologer(astrologerId)
  }

  // ── Missed session refund (cron-triggered) ─────────────────────────────
  // Booking 'confirmed' thi, payment ho chuka tha, lekin astrologer kabhi
  // join hi nahi kiya — session apne scheduled window mein kabhi 'ongoing'
  // nahi bana. Ye hamesha astrologer no-show maana jaata hai (chahe user ne
  // try kiya ho ya na kiya ho — agar user ka akela try kaafi hota to status
  // 'ongoing' ban chuka hota, sirf astrologer ka join hi ye transition
  // karta hai). Policy: is case mein user ko poora refund milta hai.
  async refundMissedSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - MISSED_SESSION_GRACE_MS)
    const missed = await this.appointmentRepository.findMissedConfirmed(cutoff)

    for (const appointment of missed) {
      await this.appointmentRepository.update(appointment.id, { status: 'missed' })

      const payment = await this.paymentRepository.findByAppointmentId(appointment.id)
      if (payment?.status === 'success' && payment.razorpayPaymentId) {
        try {
          await razorpay.payments.refund(payment.razorpayPaymentId, {})
          if (payment.razorpayOrderId) {
            await this.paymentRepository.updateByOrderId(payment.razorpayOrderId, {
              status: 'refunded',
            })
          }
        } catch (err) {
          // Refund API fail ho jaaye (network/Razorpay side) — payment
          // 'success' hi reh jaayega, appointment 'missed' ban chuka hoga —
          // ye combination admin ke liye ek clear "manual refund pending"
          // flag hai, silently kho nahi jaata
        }
      }

      this.pushNotificationService.sendToUser(appointment.userId, {
        title: 'Session Miss Ho Gaya',
        body: 'Astrologer session mein nahi aaye — tumhara poora paisa refund ho raha hai',
        data: { type: 'session_missed_refund', appointmentId: appointment.id },
      })
      this.pushNotificationService.sendToUser(appointment.astrologerId, {
        title: 'Session Miss Ho Gaya',
        body: 'Tum scheduled session mein nahi aaye — client ko refund process ho gaya hai',
        data: { type: 'session_missed_astrologer', appointmentId: appointment.id },
      })
    }

    return missed.length
  }

  // ── Cashfree flow (commented out during the Razorpay rollback — kept,
  // not deleted, for a quick re-migration) ──
  //
  // async createOrder(userId: string, dto: CreatePaymentOrderDto) { ... cfCreateOrder with order_splits ... }
  // async verifyPayment(userId: string, dto: VerifyPaymentDto) { ... cfGetOrder fallback ... }
  // async finalizeOrderPayments(cashfreeOrderId: string, cashfreePaymentId: string) { ... called from the Cashfree webhook route ... }
}
