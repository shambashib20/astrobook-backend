import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  CreateRazorpayAccountSchema,
  OnboardingSchema,
  RegisterPushTokenSchema,
  RequestAstrologerUpgradeSchema,
  UpdateProfileSchema,
} from '../schemas/user.schema'
import type { UserService } from '../services/user.service'

export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  // POST /users/me/push-token
  registerPushToken = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const dto = RegisterPushTokenSchema.parse(request.body)
    await this.pushNotificationService.registerToken(user.userId, dto.expoPushToken, dto.platform)
    return reply.status(200).send({ success: true })
  }

  /**
   * POST /users/onboarding
   * Complete onboarding (first-time setup)
   */
  onboard = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const dto = OnboardingSchema.parse(request.body)

    const updatedUser = await this.userService.onboardUser(user.userId, dto)

    return reply.status(200).send({
      message: 'Onboarding completed successfully',
      user: updatedUser,
    })
  }

  /**
   * GET /users/me
   * Get current user profile
   */
  getProfile = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const profile = await this.userService.getProfile(user.userId)

    return reply.status(200).send(profile)
  }

  /**
   * PATCH /users/me
   * Update profile
   */
  updateProfile = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const dto = UpdateProfileSchema.parse(request.body)

    const updatedUser = await this.userService.updateProfile(user.userId, dto)

    return reply.status(200).send(updatedUser)
  }

  /**
   * GET /users/me/astrologer-application
   * Current application status — app isse decide karta hai ki
   * "Upgrade to Astrologer" button dikhana hai, "Under review" dikhana
   * hai, ya rejection reason ke saath dobara try karne dena hai.
   */
  getAstrologerApplicationStatus = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const status = await this.userService.getAstrologerApplicationStatus(user.userId)
    return reply.status(200).send(status)
  }

  /**
   * POST /users/request-astrologer-upgrade
   * Astrologer banne ki application submit karo — role yahan se turant
   * NAHI badalta, admin approve karega tabhi.
   */
  requestAstrologerUpgrade = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const dto = RequestAstrologerUpgradeSchema.parse(request.body)

    await this.userService.requestAstrologerUpgrade(user.userId, dto)

    return reply.status(200).send({
      message: 'Application submitted. Our team will review it soon.',
    })
  }

  /**
   * POST /users/me/razorpay-account
   * Start Razorpay Route linked-account onboarding for a would-be astrologer.
   */
  startRazorpayOnboarding = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const dto = CreateRazorpayAccountSchema.parse(request.body)

    const account = await this.userService.startRazorpayOnboarding(user.userId, dto)

    return reply.status(201).send({
      message: account.alreadyExists
        ? 'Razorpay account already exists for this astrologer'
        : 'Razorpay account created successfully',
      account,
    })
  }
}