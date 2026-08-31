import { BadRequestError, ConflictError, NotFoundError, RateLimitError } from '@/core/errors'
import { sendOtpSms } from '@/modules/auth'
import {
  createRazorpayAccount,
  generateRazorpayReferenceId,
  getRazorpayAccount,
} from '@/core/services/razorpay-account.service'
import bcrypt from 'bcrypt'
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

    // Bank onboarding fields live on astrologer_profiles, not users — for a
    // non-astrologer (or an astrologer who hasn't onboarded yet) this row
    // simply won't exist, so both come back null rather than erroring.
    const astrologerProfile = await this.userRepository.findAstrologerApplication(userId)

    return {
      ...user,
      razorpayAccountId: astrologerProfile?.razorpayAccountId ?? null,
      razorpayAccountStatus: astrologerProfile?.razorpayAccountStatus ?? null,
    }
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

  // ── Bank onboarding (Razorpay Route linked account) ─────────────────────────
  // Astrologer ke payout account ka pehla step — POST /v2/accounts.
  // email/phone ab is request body se hi aate hain (dto.email/dto.phone) —
  // Razorpay ke liye contact details app-login identity se match karna
  // zaroori nahi hai.

  async startBankOnboarding(userId: string, dto: CreateRazorpayAccountDto) {
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

  // GET /users/me/bank-onboarding — live status pulled straight from
  // Razorpay (not just whatever we last cached in razorpayAccountResponse),
  // keyed off the account id we saved for THIS user — never accepts an
  // account id from the caller, so one user can't probe another's account.
  async getBankOnboardingStatus(userId: string) {
    const profile = await this.userRepository.findAstrologerApplication(userId)

    if (!profile?.razorpayAccountId) {
      throw NotFoundError('Bank onboarding has not been started for this astrologer yet')
    }

    return getRazorpayAccount(profile.razorpayAccountId)
  }

  // ── Phone verification (Google-login users, during onboarding) ─────────────
  // Google-login accounts have no phone on signup. This lets them add +
  // verify one afterwards. Phone-login users never call this — their phone
  // is already set from /auth/verify-otp at login time.

  async sendPhoneOtp(userId: string, phone: string): Promise<{ otp: string }> {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    // Someone else already owns this number — fail fast, before spending an
    // SMS, rather than letting them discover it only at verify-otp (where
    // the unique constraint would reject the update anyway).
    const existingOwner = await this.userRepository.findByPhone(phone)
    if (existingOwner && existingOwner.id !== userId) {
      throw ConflictError('Yeh number already kisi aur account se linked hai')
    }

    const recentCount = await this.userRepository.countRecentPhoneOtpRequests(phone)
    if (recentCount >= 3) {
      throw RateLimitError('Bahut zyada OTP requests. 10 min baad try karo.')
    }

    const otp = String(Math.floor(1000 + Math.random() * 9000))
    // Same cost-4 hash as auth's send-otp — see that file for the reasoning
    // (bcrypt's default cost buys no real security here but eats latency).
    const otpHash = await bcrypt.hash(otp, 4)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await this.userRepository.createPhoneOtp(phone, otpHash, expiresAt)

    // Awaited (not fire-and-forget) — see auth module's sendOtp for why:
    // WhatsApp delivery takes 10-15s, response should only go back once
    // it's actually sent.
    await sendOtpSms(phone, otp)

    return { otp }
  }

  async verifyPhoneOtp(userId: string, phone: string, otp: string) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    const otpRecord = await this.userRepository.findLatestPhoneOtp(phone)
    if (!otpRecord) {
      throw BadRequestError('OTP expired ya bheja nahi gaya. Dobara try karo.')
    }

    if (otpRecord.attempts >= 3) {
      throw RateLimitError('3 baar galat OTP. OTP dobara bhejo.')
    }

    const isMatch = await bcrypt.compare(otp, otpRecord.otpHash)
    if (!isMatch) {
      await this.userRepository.incrementPhoneOtpAttempts(otpRecord.id)
      throw BadRequestError('Wrong OTP')
    }

    // Re-check ownership right before writing — closes the race where
    // someone else claimed this number in between send-otp and verify-otp.
    const existingOwner = await this.userRepository.findByPhone(phone)
    if (existingOwner && existingOwner.id !== userId) {
      await this.userRepository.deletePhoneOtp(otpRecord.id)
      throw ConflictError('Yeh number already kisi aur account se linked hai')
    }

    const [, updatedUser] = await Promise.all([
      this.userRepository.deletePhoneOtp(otpRecord.id),
      this.userRepository.updatePhone(userId, phone),
    ])

    if (!updatedUser) throw NotFoundError('User not found')

    return updatedUser
  }
}