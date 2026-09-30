import { z } from 'zod'

export const SubmitReviewSchema = z.object({
  rating: z.number().int().min(1, 'Rating 1 se 5 ke beech ho').max(5, 'Rating 1 se 5 ke beech ho'),
  // Khaali comment ko null maante hain
  comment: z
    .string()
    .trim()
    .max(1000, 'Comment 1000 characters se chhota ho')
    .optional()
    .transform((v) => (v ? v : null)),
})
export type SubmitReviewDto = z.infer<typeof SubmitReviewSchema>

export const AppointmentParamsSchema = z.object({
  appointmentId: z.string().uuid(),
})

export const AstrologerParamsSchema = z.object({
  astrologerId: z.string().uuid(),
})

export const ListReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
