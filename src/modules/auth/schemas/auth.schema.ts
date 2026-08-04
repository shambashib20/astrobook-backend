import { z } from 'zod'

// ─── Send OTP ─────────────────────────────────────────────────────────────────

export const SendOtpSchema = z.object({
  phone: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, 'Valid Indian phone number daalo (+91XXXXXXXXXX)'),
})

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export const VerifyOtpSchema = z.object({
  phone: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, 'Valid Indian phone number daalo'),
  otp: z
    .string()
    .length(6, 'OTP 6 digits ka hona chahiye')
    .regex(/^\d+$/, 'OTP sirf numbers'),
})

// ─── Admin Login (email + password) ────────────────────────────────────────

export const AdminLoginSchema = z.object({
  email: z.string().email('Valid email daalo'),
  password: z.string().min(1, 'Password required'),
})

export type AdminLoginDto = z.infer<typeof AdminLoginSchema>

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
})

// ─── Logout ───────────────────────────────────────────────────────────────────

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
})

// ─── Response Types ───────────────────────────────────────────────────────────

export const UserResponseSchema = z.object({
  id:          z.string().uuid(),
  phone:       z.string().nullable(),
  email:       z.string().nullable(),
  name:        z.string().nullable(),
  role:        z.enum(['user', 'astrologer', 'admin']),
  isOnboarded: z.boolean(),
})

export const AuthResponseSchema = z.object({
  accessToken:  z.string(),
  refreshToken: z.string(),
  user:         UserResponseSchema,
  isNewUser:    z.boolean(),
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type SendOtpDto    = z.infer<typeof SendOtpSchema>
export type VerifyOtpDto  = z.infer<typeof VerifyOtpSchema>
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>
export type AuthResponse  = z.infer<typeof AuthResponseSchema>
export type UserResponse  = z.infer<typeof UserResponseSchema>

// ─── Google Login ─────────────────────────────────────────────────────────────

export const GoogleLoginSchema = z.object({
  idToken: z.string().min(1, 'Google ID token required'),
})

export type GoogleLoginDto = z.infer<typeof GoogleLoginSchema>
