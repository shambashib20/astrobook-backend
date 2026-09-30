import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  AddFavoriteSchema,
  FavoriteParamsSchema,
  ListFavoritesQuerySchema,
} from '../schemas/favorites.schema'
import type { FavoritesService } from '../services/favorites.service'

export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  add = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const dto = AddFavoriteSchema.parse(request.body)
    await this.favoritesService.add(userId, dto.itemType, dto.itemId)
    return reply.status(201).send({ success: true })
  }

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { itemType, itemId } = FavoriteParamsSchema.parse(request.params)
    await this.favoritesService.remove(userId, itemType, itemId)
    return reply.send({ success: true })
  }

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { itemType } = ListFavoritesQuerySchema.parse(request.query)
    const items = await this.favoritesService.list(userId, itemType)
    return reply.send({ success: true, data: { items } })
  }

  listIds = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { itemType } = ListFavoritesQuerySchema.parse(request.query)
    const ids = await this.favoritesService.listIds(userId, itemType)
    return reply.send({ success: true, data: { ids } })
  }
}
