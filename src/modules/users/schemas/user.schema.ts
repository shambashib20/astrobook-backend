import { z } from 'zod'
import { ALL_CATEGORIES } from '@/modules/categories/constants'

const VALID_CATEGORY_IDS = new Set<string>(ALL_CATEGORIES.map((c) => c.id))

// Categories module (`/categories`) hi single source of truth hai — post
// tags aur user interests dono isi taxonomy ke ids use karte hain, taaki
// "interest X wale user ko category X ke posts dikhao" jaisa matching
// kaam kare.
//
// Purane users (jo categories-fix se pehle onboard/edit ho chuke the) ke
// DB mein abhi bhi stale values ho sakti hain (jaise "Numerology" label,
// naye "numerology" id ki jagah). Agar hum strict reject karte (invalid id
// mila toh poori request fail), toh aise users kabhi apna profile save hi
// nahi kar paate — chahe woh sirf naam ya bio hi badalna chahte ho,
// interests ko haath tak na lagayen. Isliye reject nahi, silently filter
// karte hain — jo bhi stale/invalid values hain woh drop ho jaati hain,
// baaki save chalta rehta hai. User ko agli baar interests screen khaali
// dikhegi (jaisa already tha), lekin save kabhi block nahi hoga.
const interestsField = z
  .array(z.string())
  .optional()
  .transform((ids) => ids?.filter((id) => VALID_CATEGORY_IDS.has(id)))

export const RegisterPushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(['ios', 'android']).optional(),
})
export type RegisterPushTokenDto = z.infer<typeof RegisterPushTokenSchema>

export const OnboardingSchema = z.object({
  name:        z.string().min(2).max(255),
  email:       z.string().email().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interests:   interestsField,
})

export const UpdateProfileSchema = z.object({
  name:        z.string().min(2).max(255).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interests:   interestsField,
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

// Razorpay Route linked-account onboarding — kicks off payout account
// creation (POST /v2/accounts). email/phone are taken directly from this
// request body (not the user's DB record) — Razorpay's contact details for
// the linked account don't have to match the app-login identity 1:1.
const RazorpayAddressSchema = z.object({
  street1:     z.string().min(1),
  street2:     z.string().optional(),
  city:        z.string().min(1),
  state:       z.string().min(1),
  postalCode:  z.string().min(1),
  country:     z.string().length(2).default('IN'),
})

// Razorpay's KYC requirements differ by business_type — e.g. a PAN's 4th
// character encodes the holder type (P = individual, C = company, F = firm,
// H = HUF, ...), so Razorpay validates the PAN format against whatever
// business_type is declared here. Defaults to 'individual' so existing
// callers that don't send it keep today's behavior.
export const RazorpayBusinessTypeSchema = z.enum([
  'individual',
  'proprietorship',
  'partnership',
  'huf',
  'private_limited',
  'public_limited',
  'llp',
  'ngo',
  'trust',
  'society',
  'not_yet_registered',
  'other',
])
export type RazorpayBusinessType = z.infer<typeof RazorpayBusinessTypeSchema>

// Accepts "9830012345", "+919830012345", or "919830012345" — strips a
// leading +91/91 country code (if present) before validating the bare
// 10-digit number. Razorpay always prepends +91 itself on its side (see the
// sample response: "9830012345" in → "+919830012345" out), so we normalize
// to the bare form before it goes into the payload.
//
// Length-gated on purpose: a plain length-agnostic `replace(/^\+?91/, '')`
// would also mis-strip a real bare 10-digit number that happens to start
// with "91" (e.g. "9134567890" is a valid number on its own), cutting it
// down to 8 digits. Only strip when the total length actually matches a
// country-code-prefixed number (13 chars with "+91", 12 without).
const indianMobileSchema = z
  .string()
  .transform((v) => {
    if (v.startsWith('+91') && v.length === 13) return v.slice(3)
    if (v.startsWith('91') && v.length === 12) return v.slice(2)
    return v
  })
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'))

export const CreateRazorpayAccountSchema = z.object({
  email:              z.string().email(),
  phone:              indianMobileSchema,
  legalBusinessName: z.string().min(2).max(255),
  contactName:        z.string().min(2).max(255).optional(),
  businessType:       RazorpayBusinessTypeSchema.default('individual'),
  category:           z.string().min(1),
  subcategory:        z.string().min(1),
  address:            RazorpayAddressSchema,
})
export type CreateRazorpayAccountDto = z.infer<typeof CreateRazorpayAccountSchema>

export type OnboardingDto    = z.infer<typeof OnboardingSchema>
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>
export type UserResponse     = z.infer<typeof UserResponseSchema>