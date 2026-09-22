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
              // Additive fields — old clients that don't read these keep
              // working unchanged. null for non-astrologers and for
              // astrologers who haven't started bank onboarding yet.
              // IMPORTANT: Fastify's response schema silently strips any
              // property the service returns that isn't listed here
              // (fast-json-stringify only serializes declared properties)
              // — this is exactly why these fields must be declared, not
              // just returned from the service.
              razorpayAccountId: { type: ['string', 'null'] },
              razorpayAccountStatus: { type: ['string', 'null'] },
              razorpayProductId: { type: ['string', 'null'] },
              razorpayProductStatus: { type: ['string', 'null'] },
              // Cashfree fields — commented out during the Razorpay
              // rollback, kept for a quick re-migration.
              // cashfreeVendorId: { type: ['string', 'null'] },
              // cashfreeVendorStatus: { type: ['string', 'null'] },
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

  // POST /users/me/bank-onboarding — Razorpay Route account → product →
  // stakeholder (KYC), documents optional in the same call. Settlements
  // (bank details) are a separate step — see /me/bank-onboarding/bank-details.
  app.post(
    `${prefix}/me/bank-onboarding`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Bank onboarding — Razorpay Route account/product/stakeholder for an astrologer',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['email', 'phone', 'legalBusinessName', 'category', 'subcategory', 'address', 'pan'],
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
                'individual', 'proprietorship', 'partnership', 'huf', 'private_limited',
                'public_limited', 'llp', 'ngo', 'trust', 'society', 'not_yet_registered', 'other',
              ],
              default: 'individual',
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
                country: { type: 'string', default: 'IN' },
              },
            },
            pan: {
              type: 'string',
              pattern: '^[A-Za-z]{3}P[A-Za-z]\\d{4}[A-Za-z]$',
              description: "Owner's PAN — part of the account's stakeholder KYC",
            },
            documents: {
              type: 'array',
              description:
                'Optional — documents already uploaded to storage (e.g. ImageKit). Omit and re-call this same endpoint later once ready.',
              items: {
                type: 'object',
                required: ['url', 'type'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  type: {
                    type: 'string',
                    enum: [
                      'business_proof_url', 'business_pan_url', 'cancelled_cheque',
                      'shop_establishment_certificate', 'gst_certificate', 'msme_certificate',
                      'form_12_a_url', 'form_80g_url',
                    ],
                  },
                },
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
                  accountId: { type: 'string' },
                  productId: { type: ['string', 'null'] },
                  status: { type: ['string', 'null'] },
                  requirements: { type: 'array' },
                  documentsUploaded: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    userController.startBankOnboarding,
  )

  // POST /users/me/bank-onboarding/bank-details
  app.post(
    `${prefix}/me/bank-onboarding/bank-details`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Submit settlements (bank account) details against the Route product',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['accountNumber', 'ifscCode', 'beneficiaryName'],
          properties: {
            accountNumber: { type: 'string', minLength: 5, maxLength: 34 },
            ifscCode: { type: 'string', pattern: '^[A-Z]{4}0[A-Z0-9]{6}$' },
            beneficiaryName: { type: 'string', minLength: 2, maxLength: 120 },
          },
        },
      },
    },
    userController.submitBankDetails,
  )

  // POST /users/me/phone/send-otp
  // Google-login users add + verify a phone during onboarding. Authenticated
  // (unlike /auth/send-otp), but still costs real SMS money — same rate
  // limit shape as /auth/send-otp, keyed by (ip, phone).
  app.post(
    `${prefix}/me/phone/send-otp`,
    {
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '10 minutes',
          hook: 'preHandler',
          keyGenerator: (request: any) => `${request.ip}:${request.body?.phone ?? ''}`,
        },
      },
      schema: {
        tags: ['Users'],
        summary: 'Onboarding ke dauran phone number pe OTP bhejo (Google-login users)',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['phone'],
          properties: {
            phone: { type: 'string' },
          },
        },
      },
    },
    userController.sendPhoneOtp,
  )

  // POST /users/me/phone/verify-otp
  app.post(
    `${prefix}/me/phone/verify-otp`,
    {
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '10 minutes',
          hook: 'preHandler',
          keyGenerator: (request: any) => `${request.ip}:${request.body?.phone ?? ''}`,
        },
      },
      schema: {
        tags: ['Users'],
        summary: 'Phone OTP verify karo aur account se link karo',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['phone', 'otp'],
          properties: {
            phone: { type: 'string' },
            otp: { type: 'string', minLength: 4, maxLength: 4 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
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
    userController.verifyPhoneOtp,
  )

  // GET /users/me/bank-onboarding — live account details from Razorpay
  app.get(
    `${prefix}/me/bank-onboarding`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Users'],
        summary: "Fetch the logged-in astrologer's live Razorpay account details",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              account: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  status: { type: 'string' },
                  email: { type: 'string' },
                  phone: { type: 'string' },
                  contact_name: { type: 'string' },
                  reference_id: { type: 'string' },
                  business_type: { type: 'string' },
                  legal_business_name: { type: 'string' },
                  customer_facing_business_name: { type: 'string' },
                  created_at: { type: 'number' },
                  profile: { type: 'object', additionalProperties: true },
                  notes: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    userController.getBankOnboardingStatus,
  )
}