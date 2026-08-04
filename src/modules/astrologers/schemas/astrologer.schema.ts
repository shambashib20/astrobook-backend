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
  meta: z
    .object({
      speciality: z.string(),
      exp: z.string(),
      rating: z.number(),
      reviews: z.number(),
      languages: z.string(),
      emoji: z.string(),
      online: z.boolean(),
      price: z.number().optional(), // base price per min
      about: z.string().optional(), // profile description
    })
    .nullable(),
  isOnboarded: z.boolean(),
  createdAt: z.date(),
})

export type AstrologerResponse = z.infer<typeof AstrologerResponseSchema>
