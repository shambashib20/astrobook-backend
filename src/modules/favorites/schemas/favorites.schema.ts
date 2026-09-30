import { FAVORITE_ITEM_TYPES } from '@/core/database/schema'
import { z } from 'zod'

export const FavoriteItemTypeSchema = z.enum(FAVORITE_ITEM_TYPES)

export const AddFavoriteSchema = z.object({
  itemType: FavoriteItemTypeSchema,
  itemId: z.string().uuid(),
})

export const FavoriteParamsSchema = z.object({
  itemType: FavoriteItemTypeSchema,
  itemId: z.string().uuid(),
})

export const ListFavoritesQuerySchema = z.object({
  itemType: FavoriteItemTypeSchema.default('service'),
})

export type AddFavoriteDto = z.infer<typeof AddFavoriteSchema>
