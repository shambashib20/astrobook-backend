import Razorpay from 'razorpay'
import { env } from '@/config/env'
import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { WalletRepository } from '../repositories/wallet.repository'
import type { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
})

export class WalletService {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly paymentRepository: PaymentRepository,
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
