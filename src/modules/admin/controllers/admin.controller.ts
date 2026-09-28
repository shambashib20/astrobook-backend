import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  BanUserSchema,
  ListAstrologersQuerySchema,
  ListPostsQuerySchema,
  ListUsersQuerySchema,
  UpdateCommissionSchema,
  UpdateDocumentsSchema,
  UpdateUserRoleSchema,
  UpdateVerificationSchema,
} from '../schemas/admin.schema'
import type { AdminService } from '../services/admin.service'

type AuthedUser = { userId: string; role: string }

export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // GET /admin/stats
  getStats = async (_request: FastifyRequest, reply: FastifyReply) => {
    const stats = await this.adminService.getStats()
    return reply.status(200).send(stats)
  }

  // Cashfree vendor-refresh + refund endpoints — commented out during the
  // Razorpay rollback (kept, not deleted, for a quick re-migration).
  // refreshVendorStatus = async (request: FastifyRequest, reply: FastifyReply) => { ... }
  // listPendingRefunds = async (_request: FastifyRequest, reply: FastifyReply) => { ... }
  // approveRefund = async (request: FastifyRequest, reply: FastifyReply) => { ... }

  // GET /admin/health
  // Always 200 — the panel reads `status`/`checks[*].status` from the body
  // to render up/degraded, rather than branching on the HTTP status code
  // (a 503 here made clients treat a "degraded" reading as a failed request).
  getSystemHealth = async (_request: FastifyRequest, reply: FastifyReply) => {
    const health = await this.adminService.getSystemHealth()
    return reply.status(200).send(health)
  }

  // GET /admin/upload-token
  getUploadToken = async (_request: FastifyRequest, reply: FastifyReply) => {
    const token = this.adminService.getImageKitAuthToken()
    return reply.status(200).send(token)
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  // GET /admin/users
  listUsers = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = ListUsersQuerySchema.parse(request.query)
    const result = await this.adminService.listUsers(query)
    return reply.status(200).send(result)
  }

  // GET /admin/users/:id
  getUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const user = await this.adminService.getUser(id)
    return reply.status(200).send(user)
  }

  // PATCH /admin/users/:id/ban
  setBanStatus = async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = request.user as AuthedUser
    const { id } = request.params as { id: string }
    const dto = BanUserSchema.parse(request.body)
    const user = await this.adminService.setBanStatus(admin.userId, id, dto)
    return reply.status(200).send({ message: dto.isBanned ? 'User banned' : 'User unbanned', user })
  }

  // PATCH /admin/users/:id/role
  updateUserRole = async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = request.user as AuthedUser
    const { id } = request.params as { id: string }
    const dto = UpdateUserRoleSchema.parse(request.body)
    const user = await this.adminService.updateUserRole(admin.userId, id, dto)
    return reply.status(200).send({ message: 'Role updated', user })
  }

  // DELETE /admin/users/:id
  deleteUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = request.user as AuthedUser
    const { id } = request.params as { id: string }
    await this.adminService.deleteUser(admin.userId, id)
    return reply.status(200).send({ message: 'User deleted' })
  }

  // ── Astrologers / Verification ──────────────────────────────────────────────

  // GET /admin/astrologers
  listAstrologers = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = ListAstrologersQuerySchema.parse(request.query)
    const result = await this.adminService.listAstrologers(query)
    return reply.status(200).send(result)
  }

  // GET /admin/astrologers/:id
  getAstrologer = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const astrologer = await this.adminService.getAstrologer(id)
    return reply.status(200).send(astrologer)
  }

  // PATCH /admin/astrologers/:id/documents
  updateDocuments = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const dto = UpdateDocumentsSchema.parse(request.body)
    const profile = await this.adminService.updateDocuments(id, dto)
    return reply.status(200).send({ message: 'Documents updated', profile })
  }

  // PATCH /admin/astrologers/:id/commission
  updateCommission = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const dto = UpdateCommissionSchema.parse(request.body)
    const user = await this.adminService.updateCommission(id, dto)
    return reply.status(200).send({ message: 'Commission percentage updated', user })
  }

  // PATCH /admin/astrologers/:id/verification
  updateVerification = async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = request.user as AuthedUser
    const { id } = request.params as { id: string }
    const dto = UpdateVerificationSchema.parse(request.body)
    const profile = await this.adminService.updateVerification(admin.userId, id, dto)
    return reply.status(200).send({ message: `Verification status: ${dto.status}`, profile })
  }

  // ── Posts (moderation) ──────────────────────────────────────────────────────

  // GET /admin/posts
  listPosts = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = ListPostsQuerySchema.parse(request.query)
    const result = await this.adminService.listPosts(query)
    return reply.status(200).send(result)
  }

  // DELETE /admin/posts/:id
  deletePost = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    await this.adminService.deletePost(id)
    return reply.status(200).send({ message: 'Post removed' })
  }

  // GET /admin/transactions — current payment state ledger for reconciliation
  listTransactions = async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as {
      page?: string
      limit?: string
      status?: string
      userId?: string
      astrologerId?: string
    }
    const result = await this.adminService.listTransactions({
      page: Math.max(1, parseInt(q.page ?? '1', 10)),
      limit: Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10))),
      status: q.status,
      userId: q.userId,
      astrologerId: q.astrologerId,
    })
    return reply.status(200).send(result)
  }

  // GET /admin/transaction-events — immutable event log for dispute resolution
  listTransactionEvents = async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as {
      page?: string
      limit?: string
      event?: string
      userId?: string
      astrologerId?: string
      razorpayOrderId?: string
      appointmentId?: string
    }
    const result = await this.adminService.listTransactionEvents({
      page: Math.max(1, parseInt(q.page ?? '1', 10)),
      limit: Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10))),
      event: q.event,
      userId: q.userId,
      astrologerId: q.astrologerId,
      razorpayOrderId: q.razorpayOrderId,
      appointmentId: q.appointmentId,
    })
    return reply.status(200).send(result)
  }
}
