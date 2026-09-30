import { BadRequestError, ConflictError, NotFoundError, RateLimitError, ForbiddenError } from '@/core/errors'
import { sendOtpSms } from '@/modules/auth'
import { toCanonicalIndianPhone } from '@/core/utils/phone'
import bcrypt from 'bcrypt'
import type { UserRepository } from '../repositories/user.repository'
import type {
  OnboardingDto,
  RequestAstrologerUpgradeDto,
  SavePayoutDetailsDto,
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

    // Payout details live on astrologer_profiles, not users — for a
    // non-astrologer (or an astrologer who hasn't added them yet) this row
    // / column simply won't exist, so this comes back null rather than erroring.
    const astrologerProfile = await this.userRepository.findAstrologerApplication(userId)

    return {
      ...user,
      payoutMethod: astrologerProfile?.payoutDetails ? astrologerProfile.payoutMethod : null,
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

  // ── Payout details (manual payouts) ─────────────────────────────────────────
  // No Razorpay Route: customer payments settle into the platform's own
  // Razorpay account, and astrologers are paid out manually after
  // reconciliation. This only stores where that payout should go.

  async savePayoutDetails(userId: string, dto: SavePayoutDetailsDto) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')
    if (!user.isAstrologer) throw BadRequestError('Only astrologers can add payout details')

    const profile = await this.userRepository.savePayoutDetails(userId, dto)
    return toPayoutSummary(profile)
  }

  async getPayoutDetails(userId: string) {
    const profile = await this.userRepository.findAstrologerApplication(userId)
    if (!profile?.payoutDetails) {
      throw NotFoundError('Payout details have not been added yet')
    }
    return toPayoutSummary(profile)
  }

  // ── Phone verification (Google-login users, during onboarding) ─────────────
  // Google-login accounts have no phone on signup. This lets them add +
  // verify one afterwards. Phone-login users never call this — their phone
  // is already set from /auth/verify-otp at login time.

  async sendPhoneOtp(userId: string, rawPhone: string): Promise<{ otp: string }> {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    const phone = this.canonicalPhoneOrThrow(rawPhone)

    // Kisi aur ka number ho to SMS kharch karne se pehle hi rok do — lekin agar
    // woh sirf ek khaali duplicate phone-account hai (jaise pehle OTP se login
    // kiya tha), to allow karte hain; verify pe wahi merge ho jaata hai.
    const existingOwner = await this.userRepository.findByPhone(phone)
    if (
      existingOwner &&
      existingOwner.id !== userId &&
      !(await this.userRepository.isDisposablePhoneShell(existingOwner))
    ) {
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

  async verifyPhoneOtp(userId: string, rawPhone: string, otp: string) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    const phone = this.canonicalPhoneOrThrow(rawPhone)

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
      // Same insaan, do accounts: purana account agar sirf khaali phone-shell
      // hai to hata ke number is (asli) account ko de dete hain — ek insaan =
      // ek user. Agar usme koi bhi activity hai to auto-merge nahi karte.
      const canMerge = await this.userRepository.isDisposablePhoneShell(existingOwner)
      if (!canMerge) {
        await this.userRepository.deletePhoneOtp(otpRecord.id)
        throw ConflictError('Yeh number already kisi aur account se linked hai')
      }

      const [, merged] = await Promise.all([
        this.userRepository.deletePhoneOtp(otpRecord.id),
        this.userRepository.moveNumberFromShell(existingOwner.id, userId, phone),
      ])
      if (!merged) throw NotFoundError('User not found')
      return merged
    }

    const [, updatedUser] = await Promise.all([
      this.userRepository.deletePhoneOtp(otpRecord.id),
      this.userRepository.updatePhone(userId, phone),
    ])

    if (!updatedUser) throw NotFoundError('User not found')

    return updatedUser
  }

// ── Account deletion (anonymize) ────────────────────────────────────────────
  async deleteAccount(userId: string) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw NotFoundError('User not found')

    if (user.role === 'admin') {
      throw ForbiddenError('Admin accounts yahan se delete nahi ho sakte')
    }

    const active = await this.userRepository.countActiveAppointments(userId)
    if (active > 0) {
      throw BadRequestError(
        'Aapke upcoming ya chalte hue sessions hain. Unhe complete ya cancel karne ke baad account delete kar sakte ho.',
      )
    }

    await this.userRepository.anonymizeAccount(userId)
  }

  private canonicalPhoneOrThrow(raw: string): string {
    const phone = toCanonicalIndianPhone(raw)
    if (!phone) throw BadRequestError('Valid Indian mobile number daalo')
    return phone
  }
}

// Masked view sent back to the astrologer's own app — the full account
// number / PAN only ever go in (and to the admin panel for payouts).
function toPayoutSummary(profile: {
  payoutMethod: string | null
  payoutDetails: SavePayoutDetailsDto | null
  payoutDetailsUpdatedAt: Date | null
}) {
  const d = profile.payoutDetails!
  const mask = (v: string) => `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
  return {
    method: profile.payoutMethod,
    contactName: d.contactName,
    beneficiaryName: (d.bank ?? d.upi)?.beneficiaryName ?? null,
    accountNumber: d.bank ? mask(d.bank.accountNumber) : null,
    ifscCode: d.bank?.ifscCode ?? null,
    vpa: d.upi?.vpa ?? null,
    pan: mask(d.pan),
    updatedAt: profile.payoutDetailsUpdatedAt,
  }
}
