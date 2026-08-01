import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AuthService } from '../services/auth.service'
import { SendOtpSchema, VerifyOtpSchema, RefreshTokenSchema, LogoutSchema, GoogleLoginSchema } from '../schemas/auth.schema'
import { env } from '@/config/env'

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/send-otp
  sendOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const { phone } = SendOtpSchema.parse(request.body)
    const { otp } = await this.authService.sendOtp(phone)
    // SHOW_OTP_IN_RESPONSE sirf test/staging servers ke liye — production
    // .env mein yeh flag kabhi set nahi karna.
    return reply.status(200).send({
      success: true,
      data: env.SHOW_OTP_IN_RESPONSE ? { debugOtp: otp } : {},
    })
  }

  // POST /auth/verify-otp
  verifyOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const { phone, otp } = VerifyOtpSchema.parse(request.body)
    const result = await this.authService.verifyOtp(phone, otp)
    return reply.status(200).send({ success: true, data: result })
  }

  // POST /auth/refresh
  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = RefreshTokenSchema.parse(request.body)
    const result = await this.authService.refreshTokens(refreshToken)
    return reply.status(200).send({ success: true, data: result })
  }

  // POST /auth/logout
  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = LogoutSchema.parse(request.body)
    await this.authService.logout(refreshToken)
    return reply.status(200).send({ success: true })
  }

  // POST /auth/logout-all
  logoutAll = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    await this.authService.logoutAll(user.userId)
    return reply.status(200).send({ success: true })
  }


  // POST /auth/google
  googleLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    const { idToken } = GoogleLoginSchema.parse(request.body)
    const result = await this.authService.googleLogin(idToken)
    return reply.status(200).send({ success: true, data: result })
  }

  // GET /auth/me
  me = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const currentUser = await this.authService.getCurrentUser(user.userId)
    return reply.status(200).send({
      success: true,
      data: {
        user: {
          id: currentUser.id,
          phone: currentUser.phone,
          email: currentUser.email,
          name: currentUser.name,
          role: currentUser.role,
          isOnboarded: currentUser.isOnboarded,
          isAstrologer: currentUser.isAstrologer,
          avatarUrl: currentUser.avatarUrl ?? null,
          bio: currentUser.bio ?? null,
        },
      },
    })
  }
}