import { env } from '@/config/env'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  // CreateRazorpayAccountSchema, SubmitBankDetailsSchema — commented out
  // during the Cashfree migration, kept for rollback (see user.schema.ts).
  CreateCashfreeVendorSchema,
  OnboardingSchema,
  RegisterPushTokenSchema,
  RequestAstrologerUpgradeSchema,
  SendPhoneOtpSchema,
  UpdateProfileSchema,
  VerifyPhoneOtpSchema,
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
   * POST /users/me/bank-onboarding
   * Bank onboarding — creates/updates a Cashfree Easy Split vendor
   * (bank-or-UPI + KYC in one call) for the logged-in astrologer. Replaces
   * the old 3-step Razorpay Route wizard (account → product → bank-details)
   * with a single step; documents remain an optional follow-up call.
   */
  startBankOnboarding = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const dto = CreateCashfreeVendorSchema.parse(request.body)

    const account = await this.userService.startBankOnboarding(user.userId, dto)

    return reply.status(201).send({
      message: account.alreadyExists
        ? 'Bank onboarding already completed for this astrologer'
        : 'Bank onboarding completed — Cashfree vendor created',
      account,
    })
  }

  /**
   * GET /users/me/bank-onboarding
   * Live Cashfree vendor details for the logged-in astrologer's saved
   * vendor id — status, KYC/business info, etc., straight from Cashfree.
   */
  getBankOnboardingStatus = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const account = await this.userService.getBankOnboardingStatus(user.userId)

    return reply.status(200).send({ account })
  }

  // submitBankDetails (POST /users/me/bank-onboarding/bank-details) —
  // commented out: Cashfree collects bank/UPI details in the same call as
  // startBankOnboarding above, so this separate step no longer exists.
  // Kept here, not deleted, for rollback:
  // submitBankDetails = async (request: FastifyRequest, reply: FastifyReply) => { ... }

  /**
   * POST /users/me/phone/send-otp
   * Phone verification during onboarding (Google-login users only).
   * Wrapped { success, data } envelope — matches /auth/send-otp, which the
   * app client already parses this endpoint the same way.
   */
  sendPhoneOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { phone } = SendPhoneOtpSchema.parse(request.body)

    const { otp } = await this.userService.sendPhoneOtp(user.userId, phone)

    // SHOW_OTP_IN_RESPONSE sirf test/staging servers ke liye — production
    // .env mein yeh flag kabhi set nahi karna.
    return reply.status(200).send({
      success: true,
      data: env.SHOW_OTP_IN_RESPONSE ? { debugOtp: otp } : {},
    })
  }

  /**
   * POST /users/me/phone/verify-otp
   * Raw { user } response — matches the rest of the /users/me/* routes
   * (unwrapped, unlike /auth/verify-otp).
   */
  verifyPhoneOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { phone, otp } = VerifyPhoneOtpSchema.parse(request.body)

    const updatedUser = await this.userService.verifyPhoneOtp(user.userId, phone, otp)

    return reply.status(200).send({ user: updatedUser })
  }
}