import { getDb } from '@/core/database/client'
import type { FastifyInstance } from 'fastify'
import { AuthController } from '../controllers/auth.controller'
import { authenticate } from '../middleware/authenticate'
import { SessionRepository } from '../repositories/session.repository'
import { UserRepository } from '../repositories/user.repository'
import { AuthService } from '../services/auth.service'

export async function authRoutes(app: FastifyInstance) {
  const db = getDb()
  const userRepository = new UserRepository(db)
  const sessionRepository = new SessionRepository(db)

  const jwtService = {
    sign: (payload: any, options?: any) => app.jwt.sign(payload, options),
    verify: <T = any>(token: string): T => app.jwt.verify(token) as T,
  }

  const jwtRefreshService = {
    sign: (payload: any, options?: any) => (app as any).jwtRefreshSign(payload, options),
    verify: <T = any>(token: string): T => (app as any).jwtRefreshVerify(token) as T,
  }

  const authService = new AuthService(
    userRepository,
    sessionRepository,
    jwtService,
    jwtRefreshService,
  )
  const authController = new AuthController(authService)

  const prefix = '/auth'

  // POST /auth/admin-login — email + password, sirf role='admin' accounts ke liye
  app.post(
    `${prefix}/admin-login`,
    {
      schema: {
        tags: ['Auth'],
        summary: 'Admin login via email + password',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
      },
    },
    authController.adminLogin,
  )

  // POST /auth/send-otp
  app.post(
    `${prefix}/send-otp`,
    {
      schema: {
        tags: ['Auth'],
        summary: 'Phone number pe OTP bhejo',
        body: {
          type: 'object',
          required: ['phone'],
          properties: {
            phone: { type: 'string' },
          },
        },
      },
    },
    authController.sendOtp,
  )

  // POST /auth/verify-otp
  app.post(
    `${prefix}/verify-otp`,
    {
      schema: {
        tags: ['Auth'],
        summary: 'OTP verify karo — login ya register',
        body: {
          type: 'object',
          required: ['phone', 'otp'],
          properties: {
            phone: { type: 'string' },
            otp: { type: 'string', minLength: 4, maxLength: 4 },
          },
        },
      },
    },
    authController.verifyOtp,
  )

  // POST /auth/google
  app.post(
    `${prefix}/google`,
    {
      schema: {
        tags: ['Auth'],
        summary: 'Google idToken se login karo',
        body: {
          type: 'object',
          required: ['idToken'],
          properties: {
            idToken: { type: 'string' },
          },
        },
      },
    },
    authController.googleLogin,
  )

  // POST /auth/refresh
  app.post(
    `${prefix}/refresh`,
    {
      schema: {
        tags: ['Auth'],
        summary: 'Naya accessToken + refreshToken lo (rotation)',
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    authController.refresh,
  )

  // POST /auth/logout
  app.post(
    `${prefix}/logout`,
    {
      schema: {
        tags: ['Auth'],
        summary: 'Current session logout karo',
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    authController.logout,
  )

  // POST /auth/logout-all
  app.post(
    `${prefix}/logout-all`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Sabhi devices se logout karo',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.logoutAll,
  )

  // GET /auth/me
  app.get(
    `${prefix}/me`,
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Current user fetch karo',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.me,
  )
}