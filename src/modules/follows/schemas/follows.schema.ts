import { z } from 'zod'

export const GetFollowListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(30),
  offset: z.coerce.number().min(0).default(0),
})

export type GetFollowListQueryDto = z.infer<typeof GetFollowListQuerySchema>
