import crypto from 'crypto'
import { env } from '@/config/env'
import {
  BadRequestError,
  InvalidTokenError,
  RateLimitError,
  TokenExpiredError,
  UnauthorizedError,
} from '@/core/errors'
import axios from 'axios'
import bcrypt from 'bcrypt'
import { OAuth2Client } from 'google-auth-library'
import { sendOtpWhatsApp } from '@/core/services/whatsapp.service'
import type { SessionRepository } from '../repositories/session.repository'
import type { UserRepository } from '../repositories/user.repository'
import type { AuthResponse } from '../schemas/auth.schema'

interface JWTService {
  sign(payload: any, options?: any): string
  verify<T = any>(token: string): T
}

// ─── SMS/WhatsApp Helper ────────────────────────────────────────────────────
// Exported so other modules (e.g. users' phone-verification-during-onboarding
// flow) send OTP the exact same way instead of duplicating the delivery logic.
//
// WhatsApp expects "91XXXXXXXXXX" (country code, no "+"). Callers pass phone
// in different formats depending on which flow they came from (auth's
// /send-otp uses "+91XXXXXXXXXX", users' phone-verification uses bare
// "XXXXXXXXXX") — normalize here so both work regardless of caller.
function toWhatsAppFormat(phone: string): string {
  const digits = phone.replace(/\D/g, '') // strip +, spaces, etc.
  if (digits.length === 10) return `91${digits}`
  return digits // already has country code (e.g. "91XXXXXXXXXX")
}

export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  // Dev mode mein bhi console log rakha hai (quick visual confirm ke liye),
  // lekin ab yahin return nahi karte — WhatsApp abhi active testing mein
  // hai, dev mein bhi real message jaana chahiye. SHOW_OTP_IN_RESPONSE
  // (app ke debug-OTP autofill ke liye) alag se already kaam karta hai —
  // yeh WhatsApp delivery ko block/replace nahi karta.
  if (env.NODE_ENV === 'development') {
    console.log(`\n🔐 [DEV OTP] ${phone} → ${otp}\n`)
  }

  // MSG91 SMS — commented out for now, MSG91 account/credits not set up
  // yet. WhatsApp (below) is the active OTP channel. To re-enable SMS:
  // uncomment this block, and uncomment MSG91_AUTH_KEY/MSG91_TEMPLATE_ID
  // in src/config/env.ts.
  //
  // await axios.post(
  //   'https://api.msg91.com/api/v5/otp',
  //   {
  //     authkey:     env.MSG91_AUTH_KEY,
  //     template_id: env.MSG91_TEMPLATE_ID,
  //     mobile:      phone.replace('+', ''),
  //     otp,
  //   },
  //   { headers: { 'Content-Type': 'application/json' } }
  // )

  await sendOtpWhatsApp(toWhatsAppFormat(phone), otp)
}

// ─── AuthService ──────────────────────────────────────────────────────────────

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly jwtService: JWTService,
    private readonly jwtRefreshService: JWTService,
  ) {}

  // ── Send OTP ────────────────────────────────────────────────────────────────

  async sendOtp(phone: string): Promise<{ otp: string }> {
    const recentCount = await this.userRepository.countRecentOtpRequests(phone)
    if (recentCount >= 3) {
      throw RateLimitError('Bahut zyada OTP requests. 10 min baad try karo.')
    }

    if (env.NODE_ENV === 'development') {
      console.log(`\n🔎 [SEND DEBUG] storing OTP for phone="${phone}" (len=${phone.length})\n`)
    }

    const otp = String(Math.floor(1000 + Math.random() * 9000))
    // OTP is a 4-digit code with a 5 min expiry and a 3-attempt lockout
    // (see verifyOtp) — bcrypt's default cost of 10 (~70-100ms) buys no
    // real extra security here but ate the entire per-request latency
    // budget. Cost 4 is still salted+hashed and takes ~1ms.
    const otpHash = await bcrypt.hash(otp, 4)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await this.userRepository.createOtp(phone, otpHash, expiresAt)

    // Pehle fire-and-forget tha (background mein bhejta, response turant
    // de deta) — lekin WhatsApp delivery mein 10-15s lagte hain, isliye
    // user OTP screen pe pahunch jaata tha message aane se pehle hi, aur
    // 30s ka resend-timer usmein se already kaat chuka hota. Ab yahin
    // await karte hain — response tabhi jaata hai jab WhatsApp confirm
    // kar de, taaki frontend navigate hi tab kare jab message bhej diya
    // gaya ho (ya fail hone par turant pata chal jaye, silently na ho).
    await sendOtpSms(phone, otp)

    return { otp }
  }

  // ── Verify OTP ──────────────────────────────────────────────────────────────

  async verifyOtp(phone: string, otp: string): Promise<AuthResponse> {
    const otpRecord = await this.userRepository.findLatestOtp(phone)

    if (env.NODE_ENV === 'development') {
      console.log(
        `\n🔎 [VERIFY DEBUG] incoming phone="${phone}" incoming otp="${otp}" (len=${otp.length}) ` +
        `→ found row? ${!!otpRecord} ` +
        (otpRecord
          ? `row.id=${otpRecord.id} row.attempts=${otpRecord.attempts} row.expiresAt=${otpRecord.expiresAt} row.otpHash="${otpRecord.otpHash}"`
          : '(no non-expired row for this exact phone)') +
        '\n'
      )
    }

    if (!otpRecord) {
      throw BadRequestError('OTP expired ya bheja nahi gaya. Dobara try karo.')
    }

    if (otpRecord.attempts >= 3) {
      throw RateLimitError('3 baar galat OTP. OTP dobara bhejo.')
    }

    const isMatch = await bcrypt.compare(otp, otpRecord.otpHash)

    if (env.NODE_ENV === 'development') {
      console.log(`🔎 [VERIFY DEBUG] bcrypt.compare("${otp}", storedHash) → ${isMatch}\n`)
    }

    if (!isMatch) {
      await this.userRepository.incrementOtpAttempts(otpRecord.id)
      throw BadRequestError('Wrong OTP')
    }

    // These two don't depend on each other — deleting the used OTP and
    // looking up the user are independent writes/reads. Each DB round
    // trip to a remote Postgres costs real network latency, so run them
    // concurrently instead of one after another.
    const [, user0] = await Promise.all([
      this.userRepository.deleteOtp(otpRecord.id),
      this.userRepository.findByPhone(phone),
    ])

    let user = user0
    const isNewUser = !user

    if (!user) {
      user = await this.userRepository.createUser(phone)
    }

    const { accessToken, refreshToken } = await this._createTokens(user)

    return {
      accessToken,
      refreshToken,
      user: this._formatUser(user),
      isNewUser,
    }
  }

  // ── Admin Login (email + password) ───────────────────────────────────────────

  async adminLogin(email: string, password: string): Promise<AuthResponse> {
    const user = await this.userRepository.findByEmail(email)

    if (!user || user.role !== 'admin' || !user.passwordHash) {
      // Same generic message chahe user na mile ya password na ho — taaki
      // koi email enumerate na kar sake
      throw UnauthorizedError('Invalid email or password')
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash)
    if (!isMatch) {
      throw UnauthorizedError('Invalid email or password')
    }

    const { accessToken, refreshToken } = await this._createTokens(user)

    return {
      accessToken,
      refreshToken,
      user: this._formatUser(user),
      isNewUser: false,
    }
  }

  // ── Google Login ─────────────────────────────────────────────────────────────

  async googleLogin(idToken: string): Promise<AuthResponse> {
    if (!env.GOOGLE_CLIENT_ID) {
      throw InvalidTokenError('Google login configure nahi hai')
    }

    // Google token verify karo
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID)
    let payload: any

    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      })
      payload = ticket.getPayload()
    } catch {
      throw InvalidTokenError('Invalid Google token')
    }

    if (!payload) throw InvalidTokenError('Google token payload empty')

    const googleId = payload.sub as string
    const email    = payload.email as string | undefined
    const name     = payload.name as string | undefined
    const avatar   = payload.picture as string | undefined

    // Pehle googleId se dhundho
    let user = await this.userRepository.findByGoogleId(googleId)

    // Phir email se dhundho (same account — phone + google)
    if (!user && email) {
      user = await this.userRepository.findByEmail(email)
      if (user) {
        // Account link karo
        await this.userRepository.linkGoogleId(user.id, googleId)
      }
    }

    const isNewUser = !user

    if (!user) {
      user = await this.userRepository.createGoogleUser({ googleId, email, name, avatarUrl: avatar })
    }

    const { accessToken, refreshToken } = await this._createTokens(user)

    return {
      accessToken,
      refreshToken,
      user: this._formatUser(user),
      isNewUser,
    }
  }

  // ── Refresh Tokens ──────────────────────────────────────────────────────────

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let decoded: any
    try {
      decoded = this.jwtRefreshService.verify(refreshToken)
    } catch {
      throw TokenExpiredError('Refresh token expired ya invalid')
    }

    const session = await this.sessionRepository.findByRefreshToken(refreshToken)
    if (!session) throw UnauthorizedError('Invalid refresh token')

    if (new Date() > session.expiresAt) {
      await this.sessionRepository.deleteById(session.id)
      throw TokenExpiredError('Refresh token expired')
    }

    const user = await this.userRepository.findById(decoded.userId)
    if (!user) throw UnauthorizedError('User not found')

    // Purana session delete — rotation
    await this.sessionRepository.deleteById(session.id)

    return this._createTokens(user)
  }

  // ── Logout ──────────────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    await this.sessionRepository.deleteByRefreshToken(refreshToken)
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessionRepository.deleteByUserId(userId)
  }

  // ── Get Current User ────────────────────────────────────────────────────────

  async getCurrentUser(userId: string) {
    const user = await this.userRepository.findById(userId)
    if (!user) throw UnauthorizedError('User not found')
    return user
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private async _createTokens(user: { id: string; role: string }) {
    const accessToken = this.jwtService.sign(
      { userId: user.id, role: user.role },
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
    )
    const refreshToken = this.jwtRefreshService.sign(
      { userId: user.id, tokenId: crypto.randomUUID() },
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
    )

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    // enforceSessionLimit deletes (at most) an old session row; create()
    // inserts a new one — different rows, no dependency between them, so
    // there's no reason to pay for two sequential round trips to Neon.
    // Worst case if they interleave oddly: the user briefly has one more
    // session than MAX_SESSIONS_PER_USER, self-corrects next login.
    await Promise.all([
      this.sessionRepository.enforceSessionLimit(user.id),
      this.sessionRepository.create({ userId: user.id, refreshToken, expiresAt }),
    ])

    return { accessToken, refreshToken }
  }

  private _formatUser(user: any) {
    return {
      id:          user.id,
      phone:       user.phone,
      email:       user.email,
      name:        user.name,
      role:        user.role,
      isOnboarded: user.isOnboarded,
      isAstrologer: user.isAstrologer,
      avatarUrl:   user.avatarUrl ?? null,
      bio:         user.bio ?? null,
    }
  }
}