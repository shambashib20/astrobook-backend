import { z } from 'zod'

export const RegisterPushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(['ios', 'android']).optional(),
})
export type RegisterPushTokenDto = z.infer<typeof RegisterPushTokenSchema>

export const OnboardingSchema = z.object({
  name:        z.string().min(2).max(255),
  email:       z.string().email().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interests:   z.array(z.string()).optional(),
})

export const UpdateProfileSchema = z.object({
  name:        z.string().min(2).max(255).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interests:   z.array(z.string()).optional(),
  avatarUrl:   z.string().url().optional(),
  bio:         z.string().max(500).optional(),
})

// Astrologer bannе ke liye application — koi role/isAstrologer yahan se
// flip nahi hota, sirf ek 'pending' application banti hai. Admin panel se
// approve hone ke baad hi role change hota hai (see admin module).
export const RequestAstrologerUpgradeSchema = z.object({
  bio:              z.string().min(20, 'Bio kam se kam 20 characters ka ho').max(1000),
  experience:       z.number().int().min(0).max(70),
  languages:        z.array(z.string()).min(1, 'Kam se kam ek language chuno'),
  specializations:  z.array(z.string()).min(1, 'Kam se kam ek specialization chuno'),
  videoUrl:         z.string().url('Video upload karo'),
  document1Url:     z.string().url('Pehla document upload karo'),
  document2Url:     z.string().url('Dusra document upload karo'),
})
export type RequestAstrologerUpgradeDto = z.infer<typeof RequestAstrologerUpgradeSchema>

// GET /users/me/astrologer-application response shape — app isse decide
// karta hai ki "Upgrade to Astrologer" button dikhana hai, "Under review"
// dikhana hai, ya rejection reason ke saath dobara try karne dena hai.
export const AstrologerApplicationStatusSchema = z.object({
  hasApplied:       z.boolean(),
  verificationStatus: z.enum(['pending', 'approved', 'rejected']).nullable(),
  rejectionReason:  z.string().nullable(),
})
export type AstrologerApplicationStatus = z.infer<typeof AstrologerApplicationStatusSchema>

export const UserResponseSchema = z.object({
  id:          z.string().uuid(),
  phone:       z.string().nullable(),
  email:       z.string().nullable(),
  name:        z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  role:        z.enum(['user', 'astrologer', 'admin']),
  interests:   z.array(z.string()).nullable(),
  isOnboarded: z.boolean(),
  isAstrologer: z.boolean(),
  avatarUrl:   z.string().nullable(),
  bio:         z.string().nullable(),
  createdAt:   z.date(),
  updatedAt:   z.date(),
})

export type OnboardingDto    = z.infer<typeof OnboardingSchema>
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>
export type UserResponse     = z.infer<typeof UserResponseSchema>

export const INTEREST_OPTIONS = [
  'Numerology', 'Vastu', 'Past Life', 'Reiki', 'Tarot',
  'Astrology', 'Palmistry', 'Face Reading', 'Kundli',
  'Horoscope', 'Gemstones', 'Meditation',
] as const