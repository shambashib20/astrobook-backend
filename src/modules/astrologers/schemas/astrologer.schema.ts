import { z } from 'zod'

export const AstrologerResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  // Real uploaded profile photo — pehle isko schema mein include hi nahi
  // kiya tha, isliye zod .parse() ise silently strip kar deta tha aur
  // frontend ko kabhi avatarUrl milta hi nahi tha (hamesha emoji fallback
  // dikhta tha, chahe astrologer ne photo upload ki ho ya na ki ho).
  avatarUrl: z.string().nullable(),
  interests: z.array(z.string()).nullable(),
  // Nothing in the codebase actually writes speciality/exp/rating/reviews/
  // languages/emoji/online — they were required here but never populated
  // anywhere, so this schema broke the instant `meta` stopped being null
  // (e.g. commissionPercentage getting added). All fields optional now,
  // and .passthrough() so a new key added to meta in the future doesn't
  // silently 500 every astrologer endpoint again.
  meta: z
    .object({
      speciality: z.string().optional(),
      exp: z.string().optional(),
      rating: z.number().optional(),
      reviews: z.number().optional(),
      languages: z.string().optional(),
      emoji: z.string().optional(),
      online: z.boolean().optional(),
      price: z.number().optional(), // base price per min
      about: z.string().optional(), // profile description
      commissionPercentage: z.number().optional(),
    })
    .passthrough()
    .nullable(),
  isOnboarded: z.boolean(),
  createdAt: z.date(),
  basicServiceId: z.string().uuid().nullable().optional(),
  basicPrice: z.string().nullable().optional(),
  basicDurationMinutes: z.number().nullable().optional(),

  // ── Asli astrologer_profiles data ──
  // Pehle list sirf `users` + basic service padhti thi, isliye rating/exp/
  // languages/online kabhi app tak pahunche hi nahi (meta mein koi likhta
  // nahi). Ab yeh fields astrologer_profiles se aate hain.
  experienceYears: z.number().int().optional(),
  languages: z.array(z.string()).optional(),
  specializations: z.array(z.string()).optional(),
  // Card pe dikhane ke liye: specializations + service tags (labels), dedupe
  categories: z.array(z.string()).optional(),
  rating: z.number().optional(),
  totalReviews: z.number().int().optional(),
  followersCount: z.number().int().optional(),
  // "Abhi available" — abhi ke time pe koi active availability window hai
  isOnline: z.boolean().optional(),
  isVerified: z.boolean().optional(),
})

export type AstrologerResponse = z.infer<typeof AstrologerResponseSchema>

export const ASTROLOGER_SORTS = [
  'recommended',
  'top_rated',
  'most_followed',
  'experienced',
  'new',
  'price_low',
] as const
export type AstrologerSort = (typeof ASTROLOGER_SORTS)[number]

export const AstrologerListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(ASTROLOGER_SORTS).default('recommended'),
  // 'all' | 'online' | 'offline'
  availability: z.enum(['all', 'online', 'offline']).default('all'),
  q: z.string().trim().max(60).optional(),
  // Explore category id (e.g. 'numerology', 'vedic-astrology') — astrologer
  // jinki specializations mein yeh id hai YA jinki kisi active service ke
  // tags mein. Services/posts ke tag matching jaisa hi exact id match.
  category: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,60}$/, 'Invalid category')
    .optional(),
})
export type AstrologerListQuery = z.infer<typeof AstrologerListQuerySchema>
