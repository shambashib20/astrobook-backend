import { env } from '@/config/env'
import { getPool } from '@/core/database/client'
import { BadRequestError, NotFoundError } from '@/core/errors'
import { getAgoraUsageThisMonth } from '@/core/services/agora-usage.service'
import { createRefund as cfCreateRefund } from '@/core/services/cashfree-order.service'
import { getVendor as cfGetVendor } from '@/core/services/cashfree-vendor.service'
import type { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import {
  SESSION_SWEEP_INTERVAL_MS,
  SESSION_SWEEP_JOB,
  SETTLEMENT_INTERVAL_MS,
  SETTLEMENT_JOB,
  getCronStatus,
} from '@/core/utils/cron-heartbeat'
import { getRecentLogs } from '@/core/utils/log-buffer'
import ImageKit from 'imagekit'
import type { AdminRepository } from '../repositories/admin.repository'
import type {
  BanUserDto,
  ListAstrologersQueryDto,
  ListPostsQueryDto,
  ListUsersQueryDto,
  UpdateCommissionDto,
  UpdateDocumentsDto,
  UpdateUserRoleDto,
  UpdateVerificationDto,
} from '../schemas/admin.schema'

function paginationMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

export class AdminService {
  private imagekit: ImageKit

  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly pushNotificationService: PushNotificationService,
  ) {
    this.imagekit = new ImageKit({
      publicKey: env.IMAGEKIT_PUBLIC_KEY ?? '',
      privateKey: env.IMAGEKIT_PRIVATE_KEY ?? '',
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT ?? '',
    })
  }

  // ImageKit signed token — admin panel documents (ID proof/certificates) is se
  // seedha upload karta hai, backend sirf token deta hai (posts module jaisa hi)
  getImageKitAuthToken() {
    return this.imagekit.getAuthenticationParameters()
  }

  async getStats() {
    return this.adminRepository.getStats()
  }

  // ── System health ────────────────────────────────────────────────────────

  async getSystemHealth() {
    const [database, cron, agora] = await Promise.all([
      this.checkDatabase(),
      this.checkCron(),
      this.checkAgora(),
    ])
    const server = {
      status: 'up' as const,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    }

    // Agora "not_configured" isn't a failure — creds just haven't been added
    // yet — so it doesn't drag the overall status into "degraded".
    const overallStatus =
      database.status === 'up' && cron.status === 'up' && agora.status !== 'down'
        ? 'ok'
        : 'degraded'

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: { server, database, cron, agora },
    }
  }

  // Agora RTC usage for the current month — raw minutes/hours, no plan-quota
  // math (Agora doesn't expose the free-tier limit via API). Needs
  // AGORA_CUSTOMER_ID/SECRET (Console → RESTful API), separate from the
  // App ID/Certificate used for token signing.
  private async checkAgora() {
    const usage = await getAgoraUsageThisMonth()

    if (!usage.configured) {
      return { status: 'not_configured' as const, reason: usage.reason }
    }
    if (!usage.ok) {
      return { status: 'down' as const, error: usage.error }
    }
    return {
      status: 'up' as const,
      month: usage.month,
      totalMinutes: usage.totalMinutes,
      totalHours: usage.totalHours,
    }
  }

  private async checkDatabase() {
    const startedAt = Date.now()
    try {
      // Live SELECT 1 with a hard timeout — reflects "is Neon reachable right
      // now", not a cached/stale state.
      await Promise.race([
        getPool().query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB health check timed out')), 3000)),
      ])
      return { status: 'up' as const, latencyMs: Date.now() - startedAt, error: null, logs: [] as ReturnType<typeof getRecentLogs> }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 'down' as const,
        latencyMs: Date.now() - startedAt,
        error: message,
        logs: getRecentLogs('db'),
      }
    }
  }

  private async checkCron() {
    const jobs = [
      getCronStatus(SESSION_SWEEP_JOB, SESSION_SWEEP_INTERVAL_MS),
      getCronStatus(SETTLEMENT_JOB, SETTLEMENT_INTERVAL_MS),
    ]
    const allHealthy = jobs.every((job) => job.healthy)

    return {
      status: allHealthy ? ('up' as const) : ('down' as const),
      jobs,
      logs: allHealthy ? [] : getRecentLogs('cron'),
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async listUsers(query: ListUsersQueryDto) {
    const { rows, total } = await this.adminRepository.listUsers(query)
    return { users: rows, meta: paginationMeta(total, query.page, query.limit) }
  }

  async getUser(userId: string) {
    const user = await this.adminRepository.findUserById(userId)
    if (!user) throw NotFoundError('User not found')
    return user
  }

  async setBanStatus(adminId: string, userId: string, dto: BanUserDto) {
    if (adminId === userId && dto.isBanned) {
      throw BadRequestError('You cannot ban your own account')
    }
    const user = await this.adminRepository.findUserById(userId)
    if (!user) throw NotFoundError('User not found')

    return this.adminRepository.setBanStatus(userId, dto.isBanned, dto.reason)
  }

  async updateUserRole(adminId: string, userId: string, dto: UpdateUserRoleDto) {
    if (adminId === userId) {
      throw BadRequestError('You cannot change your own role')
    }
    const user = await this.adminRepository.findUserById(userId)
    if (!user) throw NotFoundError('User not found')

    return this.adminRepository.updateUserRole(userId, dto.role)
  }

  async deleteUser(adminId: string, userId: string) {
    if (adminId === userId) {
      throw BadRequestError('You cannot delete your own account')
    }
    const user = await this.adminRepository.findUserById(userId)
    if (!user) throw NotFoundError('User not found')

    await this.adminRepository.deleteUser(userId)
  }

  // ── Astrologers / Verification ──────────────────────────────────────────────

  async listAstrologers(query: ListAstrologersQueryDto) {
    const { rows, total } = await this.adminRepository.listAstrologers(query)
    return { astrologers: rows, meta: paginationMeta(total, query.page, query.limit) }
  }

  async getAstrologer(userId: string) {
    const astrologer = await this.adminRepository.findAstrologerById(userId)
    if (!astrologer) throw NotFoundError('Astrologer not found')
    return astrologer
  }

  async updateDocuments(userId: string, dto: UpdateDocumentsDto) {
    const astrologer = await this.adminRepository.findAstrologerById(userId)
    if (!astrologer) throw NotFoundError('Astrologer not found')

    return this.adminRepository.updateDocuments(userId, dto)
  }

  // Admin reconciliation list serves cached cashfreeVendorStatus by
  // default (see listAstrologers) — this is the on-demand "Refresh" action
  // for a single row, pulling live status straight from Cashfree.
  async refreshVendorStatus(userId: string) {
    const astrologer = await this.adminRepository.findAstrologerById(userId)
    if (!astrologer) throw NotFoundError('Astrologer not found')
    if (!astrologer.cashfreeVendorId) {
      throw BadRequestError('This astrologer has not started Cashfree onboarding yet')
    }

    const vendor = await cfGetVendor(astrologer.cashfreeVendorId)
    return this.adminRepository.updateCashfreeVendorCache(userId, {
      cashfreeVendorStatus: vendor.status,
      cashfreeVendorResponse: vendor,
    })
  }

  async updateCommission(userId: string, dto: UpdateCommissionDto) {
    const astrologer = await this.adminRepository.findAstrologerById(userId)
    if (!astrologer) throw NotFoundError('Astrologer not found')

    return this.adminRepository.updateCommissionPercentage(userId, dto.commissionPercentage)
  }

  async updateVerification(adminId: string, userId: string, dto: UpdateVerificationDto) {
    const astrologer = await this.adminRepository.findAstrologerById(userId)
    if (!astrologer) throw NotFoundError('Astrologer not found')

    if (dto.status === 'rejected' && !dto.rejectionReason) {
      throw BadRequestError('Rejection reason is required when rejecting an astrologer')
    }

    return this.adminRepository.updateVerification(userId, dto.status, adminId, dto.rejectionReason)
  }

  // ── Refunds (admin-approved — cancelling only flags a payment as
  // refund-eligible; this is the action that actually moves money) ──────────

  async listPendingRefunds() {
    return this.paymentRepository.findPendingRefunds()
  }

  async approveRefund(paymentId: string) {
    const payment = await this.paymentRepository.findById(paymentId)
    if (!payment) throw NotFoundError('Payment not found')
    if (payment.refundStatus !== 'pending') {
      throw BadRequestError('This payment is not awaiting a refund')
    }
    if (!payment.cashfreeOrderId) throw BadRequestError('No Cashfree order on this payment')

    const appointment = await this.appointmentRepository.findById(payment.appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found for this payment')

    // Mirror the split that was ACTUALLY used on the original order
    // (platformCommissionPercentage/astrologerPayoutAmount snapshotted at
    // order-creation time), not the astrologer's current commission — that
    // may have changed since.
    const astrologerPayoutAmount = Number(payment.astrologerPayoutAmount ?? 0)
    const payoutInfo = await this.paymentRepository.getAstrologerPayoutInfo(appointment.astrologerId)
    if (!payoutInfo?.cashfreeVendorId) {
      throw BadRequestError('Astrologer has no Cashfree vendor on file — cannot compute refund split')
    }

    const refund = await cfCreateRefund(payment.cashfreeOrderId, {
      refund_amount: Number(payment.amount),
      refund_id: `rfnd_${paymentId.slice(0, 8)}_${Date.now().toString(36)}`,
      refund_note: `Cancelled appointment ${appointment.id}`,
      refund_splits:
        astrologerPayoutAmount > 0
          ? [{ vendor_id: payoutInfo.cashfreeVendorId, amount: astrologerPayoutAmount }]
          : undefined,
    })

    const updated = await this.paymentRepository.recordRefund(paymentId, {
      refundStatus: 'success',
      refundedAmount: String(payment.amount),
      cashfreeRefundId: refund.cf_refund_id,
    })

    this.pushNotificationService.sendToUser(appointment.userId, {
      title: 'Refund Processed',
      body: `₹${payment.amount} refund ho gaya tumhari cancelled booking ke liye`,
      data: { type: 'refund_processed', appointmentId: appointment.id },
    })

    return updated
  }

  // ── Posts (moderation) ──────────────────────────────────────────────────────

  async listPosts(query: ListPostsQueryDto) {
    const { rows, total } = await this.adminRepository.listPosts(query)
    return { posts: rows, meta: paginationMeta(total, query.page, query.limit) }
  }

  async deletePost(postId: string) {
    const exists = await this.adminRepository.postExists(postId)
    if (!exists) throw NotFoundError('Post not found')

    await this.adminRepository.deletePost(postId)
  }
}