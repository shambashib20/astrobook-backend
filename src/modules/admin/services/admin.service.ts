import { env } from '@/config/env'
import { getPool } from '@/core/database/client'
import { BadRequestError, NotFoundError } from '@/core/errors'
import { getAgoraUsageThisMonth } from '@/core/services/agora-usage.service'
import {
  DB_KEEPALIVE_INTERVAL_MS,
  DB_KEEPALIVE_JOB,
  SESSION_SWEEP_INTERVAL_MS,
  SESSION_SWEEP_JOB,
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

  constructor(private readonly adminRepository: AdminRepository) {
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
      getCronStatus(DB_KEEPALIVE_JOB, DB_KEEPALIVE_INTERVAL_MS),
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
