import Razorpay from 'razorpay'
import { env } from '@/config/env'
import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import { AgoraService } from '@/modules/consultation/services/agora.service'
import type { WalletRepository } from '../repositories/wallet.repository'
import type { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type { PushNotificationService } from '@/core/services/push-notification.service'

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
})

export class WalletService {
  private readonly agoraService = new AgoraService()

  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly appointmentRepository?: AppointmentRepository,
    private readonly pushNotificationService?: PushNotificationService,
  ) {}

  // ── Balance ─────────────────────────────────────────────────────────────────

  async getBalance(userId: string) {
    return this.walletRepository.getBalance(userId)
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  async getTransactions(userId: string) {
    return this.walletRepository.getTransactions(userId)
  }

  // ── Pending Cancellation Choices ────────────────────────────────────────────

  async getPendingCancellations(userId: string) {
    return this.walletRepository.findPendingByUser(userId)
  }

  // ── Claim — user chooses refund or wallet credit ────────────────────────────

  async claimCancellation(
    requestId: string,
    userId: string,
    action: 'refund' | 'wallet',
  ) {
    const req = await this.walletRepository.findById(requestId)
    if (!req) throw NotFoundError('Cancellation request not found')
    if (req.userId !== userId) throw ForbiddenError('Not your cancellation request')
    if (req.status !== 'pending') throw BadRequestError('Request already processed')

    const now = new Date()
    if (req.expiresAt < now) {
      throw BadRequestError(
        'Choice window expired — auto-refund will process shortly',
      )
    }

    if (action === 'refund') {
      // Razorpay refund
      await razorpay.payments.refund(req.razorpayPaymentId, {})
      if (req.razorpayOrderId) {
        await this.paymentRepository.updateByOrderId(req.razorpayOrderId, {
          status: 'refunded',
        })
      }
      return this.walletRepository.updateStatus(requestId, 'refunded')
    } else {
      // AstroBook wallet credit
      await this.walletRepository.addCredit({
        userId,
        amount: req.amount,
        type: 'credit',
        source: 'cancellation_refund',
        cancellationRequestId: requestId,
        description: 'Astrologer ne cancel kiya — wallet credit',
      })
      return this.walletRepository.updateStatus(requestId, 'credited')
    }
  }

  // ── Pay with Wallet ─────────────────────────────────────────────────────────
  // Full wallet pay: balance >= service price → debit wallet, confirm appointment

  async payWithWallet(userId: string, appointmentId: string) {
    if (!this.appointmentRepository) {
      throw BadRequestError('Wallet pay service not configured')
    }

    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')
    if (appointment.userId !== userId) throw ForbiddenError('Not your appointment')
    if (appointment.status !== 'pending') {
      throw BadRequestError('Appointment is not in pending state')
    }

    // Price: appointment.price (booking-time snapshot) ya service price se
    const appointmentWithDetails =
      await this.appointmentRepository.findByIdWithDetails(appointmentId)
    if (!appointmentWithDetails) throw NotFoundError('Appointment details not found')

    const price = Number(
      appointmentWithDetails.price ?? appointmentWithDetails.service.price,
    )
    if (!price || price <= 0) throw BadRequestError('Invalid service price')

    // Balance check
    const { balance } = await this.walletRepository.getBalance(userId)
    if (Number(balance) < price) {
      throw BadRequestError(
        `Wallet balance (₹${balance}) is less than the required amount (₹${price})`,
      )
    }

    // Debit wallet
    await this.walletRepository.addDebit({
      userId,
      amount: String(price),
      type: 'debit',
      source: 'booking_payment',
      description: `Session booked — ${appointmentWithDetails.service.title}`,
    })

    // Generate Agora token + confirm appointment
    const { channel, token } = this.agoraService.generateToken(appointmentId)
    const confirmed = await this.appointmentRepository.update(appointmentId, {
      status: 'confirmed',
      agoraChannel: channel,
      agoraToken: token,
    })

    // Push notifications — both sides
    if (this.pushNotificationService) {
      this.pushNotificationService.sendToUser(userId, {
        title: 'Booking Confirmed!',
        body: 'Tumhari booking wallet se confirm ho gayi hai',
        data: { type: 'booking_confirmed', appointmentId },
      })
      this.pushNotificationService.sendToUser(appointment.astrologerId, {
        title: 'Naya Booking Mila',
        body: `₹${price} wallet payment mila — naya booking confirm ho gaya`,
        data: { type: 'new_booking', appointmentId },
      })
    }

    return {
      message: 'Payment successful',
      appointment: confirmed,
    }
  }

  // ── Auto-refund Sweep (cron-triggered) ─────────────────────────────────────
  // Har 5 min chalta hai — jo 24h window mein user ne kuch nahi kiya unhe
  // auto-refund kar do. Error pe skip karo (next sweep mein dobara try).

  async processExpiredCancellations(): Promise<number> {
    const now = new Date()
    const expired = await this.walletRepository.findExpiredPending(now)
    let processed = 0

    for (const req of expired) {
      try {
        await razorpay.payments.refund(req.razorpayPaymentId, {})
        if (req.razorpayOrderId) {
          await this.paymentRepository.updateByOrderId(req.razorpayOrderId, {
            status: 'refunded',
          })
        }
        await this.walletRepository.updateStatus(req.id, 'refunded')
        processed++
      } catch {
        // Log hoga server.ts mein — yahan silent continue
      }
    }

    return processed
  }
}
