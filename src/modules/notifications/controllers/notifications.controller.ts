import type { FastifyRequest, FastifyReply } from 'fastify'
import type { NotificationsService } from '../services/notifications.service'
import { GetNotificationsQuerySchema } from '../schemas/notifications.schema'

export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // GET /notifications
  getList = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { limit, offset } = GetNotificationsQuerySchema.parse(request.query)
    const notifications = await this.notificationsService.getList(user.userId, limit, offset)
    return reply.send({ success: true, data: { notifications } })
  }

  // GET /notifications/unread-count
  getUnreadCount = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const count = await this.notificationsService.getUnreadCount(user.userId)
    return reply.send({ success: true, data: { count } })
  }

  // PATCH /notifications/:id/read
  markRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.notificationsService.markRead(id, user.userId)
    return reply.send({ success: true })
  }

  // PATCH /notifications/read-all
  markAllRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    await this.notificationsService.markAllRead(user.userId)
    return reply.send({ success: true })
  }
}
