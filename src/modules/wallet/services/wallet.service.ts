import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import { AgoraService } from '@/modules/consultation/services/agora.service'
import type { WalletRepository } from '../repositories/wallet.repository'
import type { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type { PushNotificationService } from '@/core/services/push-notification.service'

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

  // ── Get cancellation request by appointment (for booking detail page) ───────
  // Any status — user dekhega ki refund kahan tak pahuncha

  async getCancellationByAppointment(appointmentId: string, userId: string) {
    const req = await this.walletRepository.findByAppointmentId(appointmentId)
    if (!req) return null
    // Security: sirf apni request
    if (req.userId !== userId) throw ForbiddenError('Not your cancellation request')
    return req
  }

  // ── Claim — user chooses refund or wallet credit ────────────────────────────
  // Ab Razorpay nahi — admin queue mein request jaati hai.
  // money → admin manually UPI pe transfer karega
  // wallet → admin approve karega, tab wallet credit hoga

  async claimCancellation(
    requestId: string,
    userId: string,
    action: 'refund' | 'wallet',
    upiId?: string,
  ) {
    const req = await this.walletRepository.findById(requestId)
    if (!req) throw NotFoundError('Cancellation request not found')
    if (req.userId !== userId) throw ForbiddenError('Not your cancellation request')
    if (req.status !== 'pending') throw BadRequestError('Request already processed')

    const now = new Date()
    if (req.expiresAt < now) {
      throw BadRequestError('Choice window expired — auto-refund process ho raha hai')
    }

    if (action === 'refund') {
      if (!upiId?.trim()) {
        throw BadRequestError('UPI ID required for money refund')
      }
      // Admin queue mein bhejo — admin manually transfer karega
      await this.walletRepository.updateCancellationFields(requestId, {
        status: 'admin_pending_money',
        upiId: upiId.trim(),
      })
      this.pushNotificationService?.sendToUser(userId, {
        title: 'Refund Request Submit Ho Gayi',
        body: '2 din mein tumhare UPI pe aa jaayega',
        data: { type: 'refund_request_submitted', requestId },
      })
    } else {
      // Wallet — admin approve karega, tab credit hoga
      await this.walletRepository.updateCancellationFields(requestId, {
        status: 'admin_pending_wallet',
      })
      this.pushNotificationService?.sendToUser(userId, {
        title: 'Wallet Credit Request Submit Ho Gayi',
        body: 'Admin approve karte hi wallet mein aa jaayega',
        data: { type: 'wallet_request_submitted', requestId },
      })
    }

    return this.walletRepository.findById(requestId)
  }

  // ── Admin: List all requests ────────────────────────────────────────────────

  async getAdminCancellationRequests(filter?: 'pending' | 'all') {
    return this.walletRepository.findAllForAdmin(filter)
  }

  // ── Admin: Approve ─────────────────────────────────────────────────────────

  async approveAdminCancellation(requestId: string) {
    const req = await this.walletRepository.findById(requestId)
    if (!req) throw NotFoundError('Cancellation request not found')

    if (
      req.status !== 'admin_pending_money' &&
      req.status !== 'admin_pending_wallet'
    ) {
      throw BadRequestError(`Cannot approve request with status: ${req.status}`)
    }

    const netAmount = Number(req.amount) - (req.deductionAmount ?? 0)

    if (req.status === 'admin_pending_wallet') {
      // Wallet credit karo
      await this.walletRepository.addCredit({
        userId: req.userId,
        amount: String(netAmount),
        type: 'credit',
        source: 'cancellation_refund',
        cancellationRequestId: requestId,
        description: 'Cancellation refund — wallet credit',
      })
      await this.walletRepository.updateCancellationFields(requestId, { status: 'credited' })

      this.pushNotificationService?.sendToUser(req.userId, {
        title: 'Wallet Credit Ho Gaya!',
        body: `₹${netAmount} tumhare AstroBook wallet mein aa gaya`,
        data: { type: 'wallet_credited', requestId },
      })
    } else {
      // money — status update; admin ne already UPI transfer kar diya
      await this.walletRepository.updateCancellationFields(requestId, { status: 'refunded' })

      this.pushNotificationService?.sendToUser(req.userId, {
        title: 'Refund Process Ho Gaya',
        body: `₹${netAmount} tumhare UPI pe bhej diya gaya hai`,
        data: { type: 'refund_processed', requestId },
      })
    }

    return this.walletRepository.findById(requestId)
  }

  // ── Admin: Reject ──────────────────────────────────────────────────────────

  async rejectAdminCancellation(requestId: string, reason?: string) {
    const req = await this.walletRepository.findById(requestId)
    if (!req) throw NotFoundError('Cancellation request not found')

    if (
      req.status !== 'admin_pending_money' &&
      req.status !== 'admin_pending_wallet'
    ) {
      throw BadRequestError(`Cannot reject request with status: ${req.status}`)
    }

    await this.walletRepository.updateCancellationFields(requestId, { status: 'admin_rejected' })

    this.pushNotificationService?.sendToUser(req.userId, {
      title: 'Refund Request Reject Ho Gayi',
      body: reason ?? 'Zyada jankari ke liye support se contact karo',
      data: { type: 'refund_rejected', requestId },
    })

    return this.walletRepository.findById(requestId)
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

    const appointmentWithDetails =
      await this.appointmentRepository.findByIdWithDetails(appointmentId)
    if (!appointmentWithDetails) throw NotFoundError('Appointment details not found')

    const price = Number(
      appointmentWithDetails.price ?? appointmentWithDetails.service.price,
    )
    if (!price || price <= 0) throw BadRequestError('Invalid service price')

    const { balance } = await this.walletRepository.getBalance(userId)
    if (Number(balance) < price) {
      throw BadRequestError(
        `Wallet balance (₹${balance}) is less than the required amount (₹${price})`,
      )
    }

    await this.walletRepository.addDebit({
      userId,
      amount: String(price),
      type: 'debit',
      source: 'booking_payment',
      description: `Session booked — ${appointmentWithDetails.service.title}`,
    })

    const { channel, token } = this.agoraService.generateToken(appointmentId)
    const confirmed = await this.appointmentRepository.update(appointmentId, {
      status: 'confirmed',
      agoraChannel: channel,
      agoraToken: token,
    })

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

  // ── Auto-claim Sweep (cron-triggered) ──────────────────────────────────────
  // Har 5 min chalta hai — jo 1 din window mein user ne kuch nahi kiya unhe
  // auto admin_pending_money queue mein daal do (UPI null — admin contact karega).

  async processExpiredCancellations(): Promise<number> {
    const now = new Date()
    const expired = await this.walletRepository.findExpiredPending(now)
    let processed = 0

    for (const req of expired) {
      try {
        await this.walletRepository.updateCancellationFields(req.id, {
          status: 'admin_pending_money',
        })

        this.pushNotificationService?.sendToUser(req.userId, {
          title: 'Time Expire Ho Gaya',
          body: 'Admin se refund process ho raha hai — jald hi UPI pe aa jaayega',
          data: { type: 'auto_refund_queued', requestId: req.id },
        })

        processed++
      } catch {
        // Log hoga server.ts mein — yahan silent continue
      }
    }

    return processed
  }
}
