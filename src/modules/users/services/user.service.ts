import { BadRequestError, ConflictError, NotFoundError, RateLimitError } from '@/core/errors'
import { sendOtpSms } from '@/modules/auth'
// Razorpay Route onboarding — commented out during the Cashfree migration,
// kept for a quick rollback (see razorpay-account.service.ts).
// import {
//   createRazorpayAccount, createStakeholder, generateRazorpayReferenceId,
//   getRazorpayAccount, requestRouteProduct, updateRouteProductSettlements,
//   uploadAccountDocument,
// } from '@/core/services/razorpay-account.service'
import {
  createVendor,
  generateCashfreeVendorId,
  getVendor,
  updateVendor,
  uploadVendorDocument,
} from '@/core/services/cashfree-vendor.service'
import bcrypt from 'bcrypt'
import type { UserRepository } from '../repositories/user.repository'
import type {
  CreateCashfreeVendorDto,
  OnboardingDto,
  RequestAstrologerUpgradeDto,
  UpdateProfileDto,
} from '../schemas/user.schema'

// Default settlement cycle assigned to every new vendor — astrologers are
// actually settled by our own monthly cron (8th of every month, see
// server.ts), not by Cashfree's own cycle, so this just needs to be a valid
// schedule_option id for the account; it isn't what drives payout timing.
const DEFAULT_SCHEDULE_OPTION = 1

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
      // razorpayAccountId/Status/ProductId/ProductStatus — commented out
      // during the Cashfree migration (kept for rollback).
      cashfreeVendorId: astrologerProfile?.cashfreeVendorId ?? null,
      cashfreeVendorStatus: astrologerProfile?.cashfreeVendorStatus ?? null,
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

  // ── Bank onboarding (Cashfree Easy Split vendor) ────────────────────────────
  // Razorpay Route's version of this (account → product → stakeholder →
  // documents, 4 staged calls) is commented out above. Cashfree collapses
  // all of that into one create/update-vendor call carrying bank-or-UPI +
  // KYC together — so this method is now just: ensure a vendor id exists,
  // create-or-update it, optionally attach documents.

  async startBankOnboarding(userId: string, dto: CreateCashfreeVendorDto) {
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

    const profile = await this.userRepository.ensureAstrologerProfile(userId)

    // vendor_id is deterministic (ast_<astrologerId>), so "does this vendor
    // already exist" is just "do we already have a saved id" — no separate
    // reference-id bookkeeping needed the way Razorpay Route required.
    const alreadyExists = !!profile.cashfreeVendorId
    const vendorId = profile.cashfreeVendorId ?? generateCashfreeVendorId(userId)

    // Shared across create and update — everything EXCEPT status, which is
    // deliberately not part of this object (see below). Cashfree's own
    // Update Vendor reference example never sends status: "ACTIVE" — it
    // only includes status when actually changing it (their sample shows
    // "DELETED"). Sending status on every PATCH, even when the vendor has
    // no valid transition back to its current state, is exactly what
    // produces "Invalid state. Allowed states are: []" — confirmed against
    // the sandbox.
    const sharedFields = {
      name: dto.contactName ?? user.name ?? dto.email,
      email: dto.email,
      phone: dto.phone,
      verify_account: true,
      dashboard_access: true,
      schedule_option: DEFAULT_SCHEDULE_OPTION,
      bank: dto.bank
        ? {
            account_number: dto.bank.accountNumber,
            account_holder: dto.bank.beneficiaryName,
            ifsc: dto.bank.ifscCode,
          }
        : undefined,
      upi: dto.upi
        ? { vpa: dto.upi.vpa, account_holder: dto.upi.beneficiaryName }
        : undefined,
      kyc_details: {
        account_type: dto.accountType,
        business_type: dto.businessCategory,
        pan: dto.pan,
        gst: dto.gst,
      },
    }

    const vendor = alreadyExists
      ? await updateVendor(vendorId, sharedFields)
      : await createVendor({ vendor_id: vendorId, status: 'ACTIVE', ...sharedFields })

    await this.userRepository.saveCashfreeVendor(userId, {
      cashfreeVendorId: vendor.vendor_id,
      cashfreeVendorStatus: vendor.status,
      cashfreeVendorResponse: vendor,
    })

    // Documents — only runs when the caller actually sent some this call. A
    // caller without documents ready yet can complete vendor creation now
    // and re-call this same endpoint later, once ImageKit URLs exist, to
    // attach them.
    const documentsUploaded: string[] = []
    if (dto.documents?.length) {
      for (const doc of dto.documents) {
        await uploadVendorDocument(vendorId, doc.type, 'KYC', doc.url)
        documentsUploaded.push(doc.type)
      }
    }

    return {
      vendorId: vendor.vendor_id,
      status: vendor.status,
      requirements: vendor.requirements ?? [],
      documentsUploaded,
      alreadyExists,
    }
  }

  // GET /users/me/bank-onboarding — live status pulled straight from
  // Cashfree (not just whatever we last cached in cashfreeVendorResponse),
  // keyed off the vendor id we saved for THIS user — never accepts a
  // vendor id from the caller, so one user can't probe another's vendor.
  async getBankOnboardingStatus(userId: string) {
    const profile = await this.userRepository.findAstrologerApplication(userId)

    if (!profile?.cashfreeVendorId) {
      throw NotFoundError('Bank onboarding has not been started for this astrologer yet')
    }

    return getVendor(profile.cashfreeVendorId)
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