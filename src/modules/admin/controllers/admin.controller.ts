import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  BanUserSchema,
  ListAstrologersQuerySchema,
  ListPostsQuerySchema,
  ListUsersQuerySchema,
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
}
