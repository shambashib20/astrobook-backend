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
})

export type AstrologerResponse = z.infer<typeof AstrologerResponseSchema>
