import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { UserRepository } from '../repositories/user.repository'
import { UserService } from '../services/user.service'
import { UserController } from '../controllers/user.controller'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { ServiceRepository } from '@/modules/consultation/repositories/service.repository'
import { authenticate } from '@/modules/auth'
import { INTEREST_OPTIONS } from '../schemas/user.schema'

export async function userRoutes(app: FastifyInstance) {
  // Dependency injection
  const db = getDb()
  const userRepository = new UserRepository(db)
  const serviceRepository = new ServiceRepository(db)
  const userService = new UserService(userRepository, serviceRepository)
  const pushNotificationService = new PushNotificationService(db)
  const userController = new UserController(userService, pushNotificationService)

  const prefix = '/users'

  // POST /users/me/push-token
  app.post(
    `${prefix}/me/push-token`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Register Expo push token for this device',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['expoPushToken'],
          properties: {
            expoPushToken: { type: 'string' },
            platform: { type: 'string', enum: ['ios', 'android'] },
          },
        },
      },
    },
    userController.registerPushToken,
  )

  // POST /users/onboarding
  app.post(
    `${prefix}/onboarding`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Complete first-time onboarding',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 2 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            dateOfBirth: { type: 'string', description: 'Format: YYYY-MM-DD' },
            interests: {
              type: 'array',
              items: { type: 'string', enum: [...INTEREST_OPTIONS] },
              minItems: 1,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              user: { type: 'object' },
            },
          },
        },
      },
    },
    userController.onboard
  )

  // GET /users/me
  app.get(
    `${prefix}/me`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Get current user profile',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
              name: { type: 'string' },
              dateOfBirth: { type: ['string', 'null'] },
              role: { type: 'string' },
              interests: { type: ['array', 'null'], items: { type: 'string' } },
              isOnboarded: { type: 'boolean' },
              isAstrologer: { type: 'boolean' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
            },
          },
        },
      },
    },
    userController.getProfile
  )

  // PATCH /users/me
  app.patch(
    `${prefix}/me`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Update user profile',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2 },
            dateOfBirth: { type: 'string' },
            interests: { type: 'array', items: { type: 'string' } },
          },
        },
        response: {
          200: {
            type: 'object',
          },
        },
      },
    },
    userController.updateProfile
  )

  // POST /users/upgrade-to-astrologer
  app.post(
    `${prefix}/upgrade-to-astrologer`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Upgrade current user to astrologer role',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              user: { type: 'object' },
            },
          },
        },
      },
    },
    userController.upgradeToAstrologer
  )

  // GET /users/interests (utility endpoint to get available interests)
  app.get(
    `${prefix}/interests`,
    {
      schema: {
        tags: ['Users'],
        summary: 'Get available interest options for onboarding',
        response: {
          200: {
            type: 'object',
            properties: {
              interests: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        interests: [...INTEREST_OPTIONS],
      })
    }
  )
}