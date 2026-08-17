import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate, optionalAuthenticate } from '@/modules/auth'
import { UserRepository } from '@/modules/users/repositories/user.repository'
import { NotificationsRepository } from '@/modules/notifications/repositories/notifications.repository'
import { NotificationsService } from '@/modules/notifications/services/notifications.service'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { FollowsRepository } from '../repositories/follows.repository'
import { FollowsService } from '../services/follows.service'
import { FollowsController } from '../controllers/follows.controller'

export async function followsRoutes(app: FastifyInstance) {
  const db = getDb()
  const followsRepository = new FollowsRepository(db)
  const userRepository = new UserRepository(db)
  const notificationsRepository = new NotificationsRepository(db)
  const pushNotificationService = new PushNotificationService(db)
  const notificationsService = new NotificationsService(notificationsRepository, pushNotificationService)
  const followsService = new FollowsService(followsRepository, userRepository, notificationsService)
  const followsController = new FollowsController(followsService)

  // POST /follows/:astrologerId — follow karo
  app.post('/follows/:astrologerId', {
    preHandler: [authenticate],
    schema: {
      tags: ['Follows'],
      summary: 'Ek astrologer ko follow karo',
      params: { type: 'object', properties: { astrologerId: { type: 'string' } } },
      security: [{ bearerAuth: [] }],
    },
  }, followsController.follow)

  // DELETE /follows/:astrologerId — unfollow karo
  app.delete('/follows/:astrologerId', {
    preHandler: [authenticate],
    schema: {
      tags: ['Follows'],
      summary: 'Unfollow karo',
      params: { type: 'object', properties: { astrologerId: { type: 'string' } } },
      security: [{ bearerAuth: [] }],
    },
  }, followsController.unfollow)

  // GET /follows/:astrologerId/status — current viewer follow karta hai ya nahi
  app.get('/follows/:astrologerId/status', {
    preHandler: [authenticate],
    schema: {
      tags: ['Follows'],
      summary: 'Current user is astrologer ko follow karta hai ya nahi',
      params: { type: 'object', properties: { astrologerId: { type: 'string' } } },
      security: [{ bearerAuth: [] }],
    },
  }, followsController.getStatus)

  // GET /follows/:userId/followers — public (kisi bhi profile pe dikh sakti hai)
  app.get('/follows/:userId/followers', {
    preHandler: [optionalAuthenticate],
    schema: {
      tags: ['Follows'],
      summary: 'Followers list',
      params: { type: 'object', properties: { userId: { type: 'string' } } },
    },
  }, followsController.getFollowers)

  // GET /follows/:userId/following — public
  app.get('/follows/:userId/following', {
    preHandler: [optionalAuthenticate],
    schema: {
      tags: ['Follows'],
      summary: 'Following list',
      params: { type: 'object', properties: { userId: { type: 'string' } } },
    },
  }, followsController.getFollowing)

  // GET /follows/:userId/counts — followers + following count
  app.get('/follows/:userId/counts', {
    preHandler: [optionalAuthenticate],
    schema: {
      tags: ['Follows'],
      summary: 'Followers/following counts',
      params: { type: 'object', properties: { userId: { type: 'string' } } },
    },
  }, followsController.getCounts)
}
