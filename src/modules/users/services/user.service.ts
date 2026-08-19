import { BadRequestError, NotFoundError } from '@/core/errors'
import {
  createRazorpayAccount,
  generateRazorpayReferenceId,
} from '@/core/services/razorpay-account.service'
import type { UserRepository } from '../repositories/user.repository'
import type {
  CreateRazorpayAccountDto,
  OnboardingDto,
  RequestAstrologerUpgradeDto,
  UpdateProfileDto,
} from '../schemas/user.schema'

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async onboardUser(userId: string, dto: OnboardingDto) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    if (user.isOnboarded) {
      throw BadRequestError('User is already onboarded')
    }

    return this.userRepository.updateOnboarding(userId, dto)
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    return user
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    return this.userRepository.updateProfile(userId, dto)
  }

  // ── Astrologer application ──────────────────────────────────────────────────
  // Submit karne se role FLIP nahi hota — sirf ek 'pending' application
  // jaati hai. Admin approve karega tabhi astrologer banega (admin module).

  async getAstrologerApplicationStatus(userId: string) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    const application = await this.userRepository.findAstrologerApplication(userId)

    return {
      hasApplied: !!application,
      verificationStatus: application?.verificationStatus ?? null,
      rejectionReason: application?.rejectionReason ?? null,
    }
  }

  async requestAstrologerUpgrade(userId: string, dto: RequestAstrologerUpgradeDto) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    if (user.isAstrologer) {
      throw BadRequestError('You are already an astrologer')
    }

    const existing = await this.userRepository.findAstrologerApplication(userId)
    if (existing?.verificationStatus === 'pending') {
      throw BadRequestError('Your application is already under review')
    }
    if (existing?.verificationStatus === 'approved') {
      throw BadRequestError('Your application is already approved')
    }
    // 'rejected' ya koi application nahi — dono cases mein resubmit allowed
    // (onConflictDoUpdate resets status back to 'pending')

    return this.userRepository.submitAstrologerApplication(userId, dto)
  }

  // ── Razorpay Route account onboarding ───────────────────────────────────────
  // Astrologer ke payout account ka pehla step — POST /v2/accounts.
  // email/phone ab is request body se hi aate hain (dto.email/dto.phone) —
  // Razorpay ke liye contact details app-login identity se match karna
  // zaroori nahi hai.

  async startRazorpayOnboarding(userId: string, dto: CreateRazorpayAccountDto) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    // Profile row must exist before we call Razorpay, so a fresh
    // reference_id only ever gets minted (and persisted) once per profile.
    const profile = await this.userRepository.ensureAstrologerProfile(userId)

    // Already has a linked account — don't create a duplicate on Razorpay's
    // side, just hand back what we already have. This (not the reference_id
    // itself) is what makes repeated calls idempotent.
    if (profile.razorpayAccountId) {
      return {
        id: profile.razorpayAccountId,
        status: profile.razorpayAccountStatus,
        referenceId: profile.razorpayReferenceId,
        alreadyExists: true,
      }
    }

    const account = await createRazorpayAccount({
      email: dto.email,
      phone: dto.phone,
      legal_business_name: dto.legalBusinessName,
      business_type: dto.businessType,
      contact_name: dto.contactName ?? user.name ?? dto.legalBusinessName,
      reference_id: generateRazorpayReferenceId(),
      profile: {
        category: dto.category,
        subcategory: dto.subcategory,
        addresses: {
          registered: {
            street1: dto.address.street1,
            street2: dto.address.street2,
            city: dto.address.city,
            state: dto.address.state,
            postal_code: dto.address.postalCode,
            country: dto.address.country,
          },
        },
      },
    })

    await this.userRepository.saveRazorpayAccount(userId, {
      razorpayAccountId: account.id,
      razorpayAccountStatus: account.status,
      razorpayReferenceId: account.reference_id,
      razorpayAccountResponse: account,
    })

    return {
      id: account.id,
      status: account.status,
      referenceId: account.reference_id,
      alreadyExists: false,
    }
  }
}