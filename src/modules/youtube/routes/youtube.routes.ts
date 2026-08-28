import { authenticate, requireRole } from '@/modules/auth'
import type { FastifyInstance } from 'fastify'
import { YoutubeController } from '../controllers/youtube.controller'
import { YoutubeAnalyticsController } from '../controllers/youtube-analytics.controller'

export async function youtubeRoutes(app: FastifyInstance) {
  const youtubeController = new YoutubeController()
  const youtubeAnalyticsController = new YoutubeAnalyticsController()

  // GET /youtube/videos — public, no auth middleware. Kept to a tighter
  // per-route limit than the global default since it's unauthenticated and
  // backed by YouTube's quota-limited API (results are cached, see
  // youtube.service.ts, so this mostly guards against a burst hammering the
  // cache-miss path).
  app.get(
    '/youtube/videos',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['YouTube'],
        summary: "Latest videos from Astrobook's YouTube channel",
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    youtubeController.getLatest,
  )

  // GET /admin/youtube/stats — admin panel only. Live subscriber count +
  // best performing video for a date range (defaults to the current
  // calendar month), so the client doesn't have to keep opening the YT
  // Studio dashboard to check these numbers.
  app.get(
    '/admin/youtube/stats',
    {
      preHandler: [authenticate, requireRole(['admin'])],
      schema: {
        tags: ['Admin'],
        summary: "Live subscriber count + best performing video for a date range",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date', description: 'Defaults to the 1st of the current month' },
            to: { type: 'string', format: 'date', description: 'Defaults to now' },
          },
        },
      },
    },
    youtubeAnalyticsController.getChannelStats,
  )
}
