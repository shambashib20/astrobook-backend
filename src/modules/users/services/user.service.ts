import { BadRequestError, ConflictError, NotFoundError, RateLimitError } from '@/core/errors'
import { sendOtpSms } from '@/modules/auth'
// Razorpay Route onboarding — active again (Cashfree migration rolled back).
import {
  createRazorpayAccount, createStakeholder, generateRazorpayReferenceId,
  getRazorpayAccount, requestRouteProduct, updateRouteProductSettlements,
  uploadAccountDocument,
} from '@/core/services/razorpay-account.service'
// Cashfree Easy Split vendor onboarding — commented out during the
// Razorpay rollback (kept, not deleted, for a quick re-migration):
// import {
//   createVendor, generateCashfreeVendorId, getVendor, updateVendor, uploadVendorDocument,
// } from '@/core/services/cashfree-vendor.service'
import bcrypt from 'bcrypt'
import type { UserRepository } from '../repositories/user.repository'
import type {
  CreateRazorpayAccountDto,
  OnboardingDto,
  RequestAstrologerUpgradeDto,
  SubmitBankDetailsDto,
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
      razorpayProductId: astrologerProfile?.razorpayProductId ?? null,
      razorpayProductStatus: astrologerProfile?.razorpayProductStatus ?? null,
      // Cashfree fields — commented out during the Razorpay rollback (kept
      // for a quick re-migration).
      // cashfreeVendorId: astrologerProfile?.cashfreeVendorId ?? null,
      // cashfreeVendorStatus: astrologerProfile?.cashfreeVendorStatus ?? null,
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

  // ── Bank onboarding (Razorpay Route) ────────────────────────────────────────
  // 4 staged calls: account → product (settlements/bank) → stakeholder (KYC)
  // → documents. Each step persists as soon as it returns, so a caller that
  // fails partway through (e.g. Razorpay's SPAM_DETECTED_ERROR heuristic on
  // step 2) can safely re-call this same endpoint to resume — the account/
  // product ids already saved are reused rather than re-created.

  async startBankOnboarding(userId: string, dto: CreateRazorpayAccountDto) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    // Email typed into the bank-onboarding form doubles as the user's
    // profile email — keep users.email in sync whenever it differs.
    if (dto.email !== user.email) {
      try {
        await this.userRepository.updateEmail(userId, dto.email)
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === '23505') {
          throw ConflictError('This email is already in use by another account')
        }
        throw err
      }
    }

    let profile = await this.userRepository.ensureAstrologerProfile(userId)

    // Step 1 — account (only if not already created for this astrologer).
    let accountId = profile.razorpayAccountId
    if (!accountId) {
      const referenceId = generateRazorpayReferenceId()
      const account = await createRazorpayAccount({
        email: dto.email,
        phone: dto.phone,
        legal_business_name: dto.legalBusinessName,
        business_type: dto.businessType,
        contact_name: dto.contactName ?? user.name ?? dto.email,
        reference_id: referenceId,
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
      profile = (await this.userRepository.saveRazorpayAccount(userId, {
        razorpayAccountId: account.id,
        razorpayAccountStatus: account.status,
        razorpayReferenceId: referenceId,
        razorpayAccountResponse: account,
      }))!
      accountId = account.id
    }

    // Step 2 — Route product (only if not already requested).
    let productId = profile.razorpayProductId
    if (!productId) {
      const product = await requestRouteProduct(accountId)
      profile = (await this.userRepository.saveRazorpayProduct(userId, {
        razorpayProductId: product.id,
        razorpayProductStatus: product.activation_status,
        razorpayProductResponse: product,
      }))!
      productId = product.id
    }

    // Step 3 — stakeholder (KYC — PAN + contact), only once.
    if (!profile.razorpayStakeholderId) {
      const stakeholder = await createStakeholder(accountId, {
        name: dto.contactName ?? user.name ?? dto.email,
        email: dto.email,
        relationship: { director: true },
        kyc: { pan: dto.pan },
      })
      profile = (await this.userRepository.saveRazorpayStakeholder(userId, {
        razorpayStakeholderId: stakeholder.id,
        razorpayStakeholderResponse: stakeholder,
      }))!
    }

    // Step 4 — documents. Only runs when the caller actually sent some this
    // call. A caller without documents ready yet can complete the earlier
    // steps now and re-call this same endpoint later, once ImageKit URLs
    // exist, to attach them.
    const documentsUploaded: string[] = []
    if (dto.documents?.length) {
      const uploadedByType: Record<string, unknown> = {}
      for (const doc of dto.documents) {
        uploadedByType[doc.type] = await uploadAccountDocument(accountId, doc.type, doc.url)
        documentsUploaded.push(doc.type)
      }
      await this.userRepository.saveRazorpayDocuments(userId, uploadedByType)
    }

    return {
      accountId,
      productId,
      status: profile.razorpayProductStatus ?? profile.razorpayAccountStatus,
      requirements:
        (profile.razorpayProductResponse as { requirements?: unknown[] } | null)?.requirements ?? [],
      documentsUploaded,
    }
  }

  // POST /users/me/bank-onboarding/bank-details — separate step: submits the
  // settlements (bank account) block against the Route product created above.
  async submitBankDetails(userId: string, dto: SubmitBankDetailsDto) {
    const profile = await this.userRepository.findAstrologerApplication(userId)
    if (!profile?.razorpayAccountId || !profile.razorpayProductId) {
      throw NotFoundError('Bank onboarding has not been started for this astrologer yet')
    }

    const product = await updateRouteProductSettlements(
      profile.razorpayAccountId,
      profile.razorpayProductId,
      {
        account_number: dto.accountNumber,
        ifsc_code: dto.ifscCode,
        beneficiary_name: dto.beneficiaryName,
      },
    )

    return this.userRepository.saveRazorpayProduct(userId, {
      razorpayProductId: product.id,
      razorpayProductStatus: product.activation_status,
      razorpayProductResponse: product,
    })
  }

  // GET /users/me/bank-onboarding — live status pulled straight from
  // Razorpay, keyed off the account id we saved for THIS user — never
  // accepts an account id from the caller, so one user can't probe
  // another's account.
  async getBankOnboardingStatus(userId: string) {
    const profile = await this.userRepository.findAstrologerApplication(userId)

    if (!profile?.razorpayAccountId) {
      throw NotFoundError('Bank onboarding has not been started for this astrologer yet')
    }

    return getRazorpayAccount(profile.razorpayAccountId)
  }

  // ── Cashfree Easy Split vendor onboarding (commented out during the
  // Razorpay rollback — kept, not deleted, for a quick re-migration) ──
  // async startBankOnboarding(userId: string, dto: CreateCashfreeVendorDto) { ... }
  // async getBankOnboardingStatus(userId: string) { ... getVendor(...) ... }

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