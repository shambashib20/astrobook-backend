import { getDb } from '@/core/database/client'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { authenticate } from '@/modules/auth'
import type { FastifyInstance } from 'fastify'
import { UserController } from '../controllers/user.controller'
import { UserRepository } from '../repositories/user.repository'
import { ALL_CATEGORIES } from '@/modules/categories/constants'
import { UserService } from '../services/user.service'

export async function userRoutes(app: FastifyInstance) {
  // Dependency injection
  const db = getDb()
  const userRepository = new UserRepository(db)
  const userService = new UserService(userRepository)
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
              items: { type: 'string', enum: ALL_CATEGORIES.map((c) => c.id) },
              minItems: 1,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              user: {
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
                  avatarUrl: { type: ['string', 'null'] },
                  bio: { type: ['string', 'null'] },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
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
              avatarUrl: { type: ['string', 'null'] },
              bio: { type: ['string', 'null'] },
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
            avatarUrl: { type: 'string' },
            bio: { type: 'string', maxLength: 500 },
          },
        },
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
              avatarUrl: { type: ['string', 'null'] },
              bio: { type: ['string', 'null'] },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
            },
          },
        },
      },
    },
    userController.updateProfile
  )

  // POST /users/request-astrologer-upgrade
  app.post(
    `${prefix}/request-astrologer-upgrade`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Submit an application to become an astrologer (pending admin review)',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: [
            'bio',
            'experience',
            'languages',
            'specializations',
            'videoUrl',
            'document1Url',
            'document2Url',
          ],
          properties: {
            bio: { type: 'string', minLength: 20, maxLength: 1000 },
            experience: { type: 'integer', minimum: 0, maximum: 70 },
            languages: { type: 'array', items: { type: 'string' }, minItems: 1 },
            specializations: { type: 'array', items: { type: 'string' }, minItems: 1 },
            videoUrl: { type: 'string' },
            document1Url: { type: 'string' },
            document2Url: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
        },
      },
    },
    userController.requestAstrologerUpgrade,
  )

  // GET /users/me/astrologer-application
  app.get(
    `${prefix}/me/astrologer-application`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Get current astrologer application status',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              hasApplied: { type: 'boolean' },
              verificationStatus: {
                type: ['string', 'null'],
                enum: ['pending', 'approved', 'rejected', null],
              },
              rejectionReason: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    userController.getAstrologerApplicationStatus,
  )

  // POST /users/me/razorpay-account
  app.post(
    `${prefix}/me/razorpay-account`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Start Razorpay Route account onboarding (payouts) for an astrologer',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['email', 'phone', 'legalBusinessName', 'category', 'subcategory', 'address'],
          properties: {
            email: { type: 'string', format: 'email' },
            phone: {
              type: 'string',
              pattern: '^(\\+91|91)?[6-9]\\d{9}$',
              description:
                'Indian mobile number — with or without +91/91 country code (e.g. "9830012345" or "+919830012345")',
            },
            legalBusinessName: { type: 'string', minLength: 2, maxLength: 255 },
            contactName: { type: 'string', minLength: 2, maxLength: 255 },
            businessType: {
              type: 'string',
              enum: [
                'individual',
                'proprietorship',
                'partnership',
                'huf',
                'private_limited',
                'public_limited',
                'llp',
                'ngo',
                'trust',
                'society',
                'not_yet_registered',
                'other',
              ],
              default: 'individual',
              description: 'Determines which PAN/KYC format Razorpay expects for this account',
            },
            category: { type: 'string' },
            subcategory: { type: 'string' },
            address: {
              type: 'object',
              required: ['street1', 'city', 'state', 'postalCode'],
              properties: {
                street1: { type: 'string' },
                street2: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                postalCode: { type: 'string' },
                country: { type: 'string', minLength: 2, maxLength: 2, default: 'IN' },
              },
            },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              account: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  status: { type: ['string', 'null'] },
                  referenceId: { type: ['string', 'null'] },
                  alreadyExists: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    userController.startRazorpayOnboarding,
  )
}