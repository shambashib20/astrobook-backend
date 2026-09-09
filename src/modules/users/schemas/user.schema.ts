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

// ── Razorpay Route schemas (commented out during the Cashfree migration —
// kept, not deleted, for a quick rollback) ──
// const RazorpayAddressSchema = z.object({
//   street1:     z.string().min(1),
//   street2:     z.string().optional(),
//   city:        z.string().min(1),
//   state:       z.string().min(1),
//   postalCode:  z.string().min(1),
//   country:     z.string().length(2).default('IN'),
// })
// export const RazorpayBusinessTypeSchema = z.enum([
//   'individual', 'proprietorship', 'partnership', 'huf', 'private_limited',
//   'public_limited', 'llp', 'ngo', 'trust', 'society', 'not_yet_registered', 'other',
// ])
// export type RazorpayBusinessType = z.infer<typeof RazorpayBusinessTypeSchema>

// Cashfree Easy Split vendor account_type — maps to kyc_details.account_type
// in the vendor create/update payload. Defaults to 'Individual' since most
// astrologers onboard as individuals, not registered businesses.
export const CashfreeAccountTypeSchema = z.enum([
  'Individual',
  'Proprietorship',
  'Partnership',
  'LLP',
  'Private Limited',
  'Public Limited',
  'Trust',
  'NGO',
  'Society',
  'Other',
])
export type CashfreeAccountType = z.infer<typeof CashfreeAccountTypeSchema>

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

// PAN format: 5 letters, 4 digits, 1 letter — the 4th letter encodes holder
// type (P = individual), matching the stakeholder being this account's
// individual owner.
const panSchema = z
  .string()
  // Real PAN structure: 5 letters (4th = holder type, P for individual) +
  // 4 digits + 1 letter = 10 chars total — {3}P[A-Za-z], not {4}P.
  .regex(/^[A-Za-z]{3}P[A-Za-z]\d{4}[A-Za-z]$/, 'Invalid PAN')
  .transform((v) => v.toUpperCase())

// ── Razorpay Route document/account schemas (commented out — see note
// above; kept for rollback) ──
// export const RazorpayDocumentTypeSchema = z.enum([
//   'business_proof_url', 'business_pan_url', 'cancelled_cheque',
//   'shop_establishment_certificate', 'gst_certificate', 'msme_certificate',
//   'form_12_a_url', 'form_80g_url',
// ])
// export const CreateRazorpayAccountSchema = z.object({
//   email:              z.string().email(),
//   phone:              indianMobileSchema,
//   legalBusinessName: z.string().min(2).max(255),
//   contactName:        z.string().min(2).max(255).optional(),
//   businessType:       RazorpayBusinessTypeSchema.default('individual'),
//   category:           z.string().min(1),
//   subcategory:        z.string().min(1),
//   address:            RazorpayAddressSchema,
//   pan:                panSchema,
//   documents:          z.array(z.object({ url: z.string().url(), type: RazorpayDocumentTypeSchema })).optional(),
// })
// export type CreateRazorpayAccountDto = z.infer<typeof CreateRazorpayAccountSchema>
// export const SubmitBankDetailsSchema = z.object({
//   accountNumber:   z.string().min(5).max(34),
//   ifscCode:        z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
//   beneficiaryName: z.string().min(2).max(120),
// })
// export type SubmitBankDetailsDto = z.infer<typeof SubmitBankDetailsSchema>

// Cashfree Easy Split vendor documents — client uploads to ImageKit first
// (same convention as document1Url/document2Url on the astrologer
// application) and hands us the URL; we fetch it and re-upload the bytes to
// Cashfree's vendor-docs API. doc_type/doc_category are validated against
// Cashfree's own accepted values server-side — confirm the exact list
// against the sandbox before shipping the picker copy.
export const CashfreeDocumentTypeSchema = z.enum([
  'pan_card',
  'gst_certificate',
  'cancelled_cheque',
  'business_proof',
  'id_proof',
])

// Bank OR UPI, at least one required — Cashfree vendors can settle to
// either, unlike Razorpay Route's bank-account-only settlements step.
const CashfreeBankDetailsSchema = z.object({
  accountNumber:   z.string().min(5).max(34),
  ifscCode:        z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  beneficiaryName: z.string().min(2).max(120),
})
const CashfreeUpiDetailsSchema = z.object({
  vpa:             z.string().min(3).max(120),
  beneficiaryName: z.string().min(2).max(120),
})

// Cashfree's kyc_details.business_type is a FIXED enum, not free text —
// confirmed against the sandbox (a plain string like "Astrology
// Consulting" gets rejected with INVALID_REQUEST_TYPE, listing exactly
// this set). "Professional Services" is the closest fit for an astrologer
// consultation business.
export const CashfreeBusinessCategorySchema = z.enum([
  'Grocery',
  'Jewellery',
  'Miscellaneous',
  'Web host/Domain seller',
  'E-commerce',
  'Online Gaming',
  'Society/Trust/Club/Association',
  'Mutual funds/Broking',
  'B2B',
  'Real Estate',
  'Housing',
  'Rentals',
  'Utilities',
  'Travel and Hospitality',
  'Education',
  'Food and Beverages',
  'NBFCs/Organizations into Lending',
  'Chit Funds',
  'Non Profit/NGO',
  'Financial Services',
  'Government',
  'Readymade',
  'SaaS',
  'Professional Services (Doctors, Lawyers, Architects, CAs, and other Professionals)',
  'Open and Semi Open Wallet',
  'Social Media and Entertainment',
  'Pan shop',
  'Telecom',
  'Digital Goods',
  'Insurance',
  'Pharmacy',
  'Healthcare',
  'Retail and Shopping',
  'Gaming',
  'Logistics',
])
export type CashfreeBusinessCategory = z.infer<typeof CashfreeBusinessCategorySchema>

// Single call — business/KYC + bank-or-UPI all together, matching
// Cashfree's one-step vendor create/update (vs. Razorpay Route's
// account → product → stakeholder → documents dance).
export const CreateCashfreeVendorSchema = z
  .object({
    email:          z.string().email(),
    phone:          indianMobileSchema,
    contactName:    z.string().min(2).max(255),
    accountType:    CashfreeAccountTypeSchema.default('Individual'),
    businessCategory: CashfreeBusinessCategorySchema.default(
      'Professional Services (Doctors, Lawyers, Architects, CAs, and other Professionals)',
    ),
    pan:            panSchema,
    gst:            z.string().min(1).optional(),
    bank:           CashfreeBankDetailsSchema.optional(),
    upi:            CashfreeUpiDetailsSchema.optional(),
    // Whatever documents the caller already has ready. Optional — a caller
    // without documents yet can still complete vendor creation, and
    // re-call this same endpoint later once documents are uploaded.
    documents:      z.array(z.object({ url: z.string().url(), type: CashfreeDocumentTypeSchema })).optional(),
  })
  .refine((dto) => !!dto.bank || !!dto.upi, {
    message: 'Provide either bank account details or a UPI ID',
    path: ['bank'],
  })
export type CreateCashfreeVendorDto = z.infer<typeof CreateCashfreeVendorSchema>

// Phone verification during onboarding — for Google-login users who don't
// have a phone on their account yet. Phone-login users never hit this (their
// phone is already set from login), so this is purely additive.
export const SendPhoneOtpSchema = z.object({
  phone: indianMobileSchema,
})
export type SendPhoneOtpDto = z.infer<typeof SendPhoneOtpSchema>

export const VerifyPhoneOtpSchema = z.object({
  phone: indianMobileSchema,
  otp:   z.string().length(4, 'OTP 4 digits ka hona chahiye'),
})
export type VerifyPhoneOtpDto = z.infer<typeof VerifyPhoneOtpSchema>

export type OnboardingDto    = z.infer<typeof OnboardingSchema>
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>
export type UserResponse     = z.infer<typeof UserResponseSchema>