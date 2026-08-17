import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { NotificationsRepository } from '../repositories/notifications.repository'
import { NotificationsService } from '../services/notifications.service'
import { NotificationsController } from '../controllers/notifications.controller'

export async function notificationsRoutes(app: FastifyInstance) {
  const db = getDb()
  const notificationsRepository = new NotificationsRepository(db)
  const pushNotificationService = new PushNotificationService(db)
  const notificationsService = new NotificationsService(notificationsRepository, pushNotificationService)
  const notificationsController = new NotificationsController(notificationsService)

  // GET /notifications
  app.get('/notifications', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Current user ki notifications, latest first',
      security: [{ bearerAuth: [] }],
    },
  }, notificationsController.getList)

  // GET /notifications/unread-count
  app.get('/notifications/unread-count', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Unread notifications ka count (badge ke liye)',
      security: [{ bearerAuth: [] }],
    },
  }, notificationsController.getUnreadCount)

  // PATCH /notifications/read-all
  app.patch('/notifications/read-all', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Sabhi notifications read mark karo',
      security: [{ bearerAuth: [] }],
    },
  }, notificationsController.markAllRead)

  // PATCH /notifications/:id/read
  app.patch('/notifications/:id/read', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Ek notification read mark karo',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      security: [{ bearerAuth: [] }],
    },
  }, notificationsController.markRead)
}
