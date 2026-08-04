import { env } from '@/config/env'
import { BadRequestError, NotFoundError } from '@/core/errors'
import ImageKit from 'imagekit'
import type { AdminRepository } from '../repositories/admin.repository'
import type {
  BanUserDto,
  ListAstrologersQueryDto,
  ListPostsQueryDto,
  ListUsersQueryDto,
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
