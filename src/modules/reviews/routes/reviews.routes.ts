import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'
import type { FastifyInstance } from 'fastify'
import { ReviewsController } from '../controllers/reviews.controller'
import { ReviewsRepository } from '../repositories/reviews.repository'
import { ReviewsService } from '../services/reviews.service'

export async function reviewsRoutes(app: FastifyInstance) {
  const db = getDb()
  const controller = new ReviewsController(new ReviewsService(new ReviewsRepository(db)))

  // POST /appointments/:appointmentId/review { rating, comment? }
  // Create ya update — sirf apni completed session ke liye
  app.post(
    '/appointments/:appointmentId/review',
    {
      preHandler: [authenticate],
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
      schema: {
        tags: ['Reviews'],
        summary: 'Completed session ko rating/review do (dobara bhejo to update hota hai)',
        security: [{ bearerAuth: [] }],
      },
    },
    controller.submit,
  )

  // DELETE /appointments/:appointmentId/review — apni review hatao
  app.delete(
    '/appointments/:appointmentId/review',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Reviews'],
        summary: 'Apni review delete karo',
        security: [{ bearerAuth: [] }],
      },
    },
    controller.remove,
  )

  // GET /reviews/mine — meri di hui reviews
  app.get(
    '/reviews/mine',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Reviews'],
        summary: 'Meri di hui saari reviews',
        security: [{ bearerAuth: [] }],
      },
    },
    controller.listMine,
  )

  // GET /astrologers/:astrologerId/reviews — public
  app.get(
    '/astrologers/:astrologerId/reviews',
    {
      schema: {
        tags: ['Reviews'],
        summary: 'Astrologer ki reviews + rating summary',
      },
    },
    controller.listForAstrologer,
  )
}
