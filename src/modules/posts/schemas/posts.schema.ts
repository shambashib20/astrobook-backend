import { z } from 'zod'

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/

export const CreatePostSchema = z.object({
  content: z.string().min(1, 'Content required').max(2000),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['IMAGE', 'VIDEO', 'TEXT']).default('TEXT'),
  bgColor: z.string().regex(HEX_COLOR).optional(),
  textColor: z.string().regex(HEX_COLOR).optional(),
  // 5 min hard cap — frontend bhi enforce karta hai, yeh sirf backend-side
  // safety net hai (client compress/trim ke baad ka actual duration bhejega)
  durationSeconds: z.number().int().positive().max(300).optional(),
  // IMAGE sticker — optional draggable text overlay
  stickerText: z.string().max(100).optional(),
  stickerX: z.number().min(0).max(1).optional(),
  stickerY: z.number().min(0).max(1).optional(),
  stickerTextColor: z.string().regex(HEX_COLOR).optional(),
  stickerBgColor: z.string().optional(), // rgba bhi allowed (STICKER_BG_COLORS mein hai)
  linkedServiceId: z.string().uuid().optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
})

// Post edit — media (photo/video) badalna allowed nahi (Instagram jaisa),
// sirf caption, categories aur TEXT post ke colours. Kam-se-kam ek field zaroori.
export const UpdatePostSchema = z
  .object({
    content: z.string().min(1, 'Content required').max(2000).optional(),
    tags: z.array(z.string().min(1)).max(5).optional(),
    bgColor: z.string().regex(HEX_COLOR).optional(),
    textColor: z.string().regex(HEX_COLOR).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Kuch to badlo',
  })

export const CreateCommentSchema = z.object({
  content: z.string().min(1, 'Comment khaali nahi ho sakta').max(500),
})

export const GetPostsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
  astrologerId: z.string().uuid().optional(),
  tag: z.string().optional(),
})

export const GetRelatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(3),
})

export const PostIdParamSchema = z.object({
  id: z.string().uuid(),
})

export type CreatePostDto = z.infer<typeof CreatePostSchema>
export type UpdatePostDto = z.infer<typeof UpdatePostSchema>
export type CreateCommentDto = z.infer<typeof CreateCommentSchema>
export type GetPostsQueryDto = z.infer<typeof GetPostsQuerySchema>