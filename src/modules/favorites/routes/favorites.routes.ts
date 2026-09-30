import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'
import { ServiceRepository } from '@/modules/consultation/repositories/service.repository'
import type { FastifyInstance } from 'fastify'
import { FavoritesController } from '../controllers/favorites.controller'
import { FavoritesRepository } from '../repositories/favorites.repository'
import { FavoritesService } from '../services/favorites.service'

export async function favoritesRoutes(app: FastifyInstance) {
  const db = getDb()
  const favoritesService = new FavoritesService(
    new FavoritesRepository(db),
    new ServiceRepository(db),
  )
  const controller = new FavoritesController(favoritesService)

  // POST /favorites { itemType, itemId } — favourite mein add (idempotent)
  app.post('/favorites', { preHandler: [authenticate] }, controller.add)

  // GET /favorites?itemType=service — enriched list (Favourites screen)
  app.get('/favorites', { preHandler: [authenticate] }, controller.list)

  // GET /favorites/ids?itemType=service — sirf ids (cards pe heart ki state)
  app.get('/favorites/ids', { preHandler: [authenticate] }, controller.listIds)

  // DELETE /favorites/:itemType/:itemId — favourite se hatao
  app.delete('/favorites/:itemType/:itemId', { preHandler: [authenticate] }, controller.remove)
}
