import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate, optionalAuthenticate } from '@/modules/auth'
import { UserRepository } from '@/modules/users/repositories/user.repository'
import { FollowsRepository } from '@/modules/follows/repositories/follows.repository'
import { NotificationsRepository } from '@/modules/notifications/repositories/notifications.repository'
import { NotificationsService } from '@/modules/notifications/services/notifications.service'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { PostsRepository } from '../repositories/posts.repository'
import { PostsService } from '../services/posts.service'
import { PostsController } from '../controller/posts.controller'

export async function postsRoutes(app: FastifyInstance) {
  const db = getDb()
  const postsRepository = new PostsRepository(db)
  const userRepository = new UserRepository(db)
  const followsRepository = new FollowsRepository(db)
  const notificationsRepository = new NotificationsRepository(db)
  const pushNotificationService = new PushNotificationService(db)
  const notificationsService = new NotificationsService(notificationsRepository, pushNotificationService)
  const postsService    = new PostsService(postsRepository, userRepository, followsRepository, notificationsService)
  const postsController = new PostsController(postsService)

  // GET /posts — public, feed ke liye (agar logged in ho toh isLikedByMe milega)
  app.get('/posts', {
    preHandler: [optionalAuthenticate],
  }, postsController.getAll)

  // GET /posts/my — authenticated, astrologer ke apne posts
  app.get('/posts/my', {
    preHandler: [authenticate],
  }, postsController.getMy)

  // GET /posts/upload-token — ImageKit auth token
  app.get('/posts/upload-token', {
    preHandler: [authenticate],
  }, postsController.getUploadToken)

  // POST /posts — authenticated, astrologer only
  app.post('/posts', {
    preHandler: [authenticate],
    schema: {
      tags: ['Posts'],
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content:         { type: 'string' },
          mediaUrl:        { type: 'string' },
          mediaType:       { type: 'string', enum: ['IMAGE', 'VIDEO', 'TEXT'] },
          bgColor:         { type: 'string' },
          textColor:       { type: 'string' },
          durationSeconds: { type: 'number' },
          linkedServiceId: { type: 'string' },
        },
      },
    },
  }, postsController.create)

  // GET /posts/:id — single post detail (public, optional auth)
  // NOTE: yeh route pehle missing thi — controller method exist karta tha
  // lekin kabhi register hi nahi hua tha, isliye post detail page mock data
  // pe hi chal raha tha
  app.get('/posts/:id', {
    preHandler: [optionalAuthenticate],
    schema: {
      tags: ['Posts'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, postsController.getById)

  // DELETE /posts/:id — authenticated
  app.delete('/posts/:id', {
    preHandler: [authenticate],
    schema: {
      tags: ['Posts'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, postsController.delete)

  // ── Likes ────────────────────────────────────────────────────────────────

  // POST /posts/:id/like
  app.post('/posts/:id/like', {
    preHandler: [authenticate],
    schema: {
      tags: ['Posts'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, postsController.like)

  // DELETE /posts/:id/like
  app.delete('/posts/:id/like', {
    preHandler: [authenticate],
    schema: {
      tags: ['Posts'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, postsController.unlike)

  // ── Comments ─────────────────────────────────────────────────────────────

  // POST /posts/:id/comments
  app.post('/posts/:id/comments', {
    preHandler: [authenticate],
    schema: {
      tags: ['Posts'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string' } },
      },
    },
  }, postsController.addComment)

  // GET /posts/:id/comments — public
  app.get('/posts/:id/comments', {
    schema: {
      tags: ['Posts'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, postsController.getComments)

  // DELETE /posts/comments/:commentId — apna comment delete karna
  app.delete('/posts/comments/:commentId', {
    preHandler: [authenticate],
    schema: {
      tags: ['Posts'],
      params: { type: 'object', properties: { commentId: { type: 'string' } } },
    },
  }, postsController.deleteComment)
}
