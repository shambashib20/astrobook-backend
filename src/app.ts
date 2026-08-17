import { env } from '@/config/env'
import { registerPlugins } from '@/core/plugins'
import { authRoutes } from '@/modules/auth'
import { consultationRoutes } from '@/modules/consultation'
import { userRoutes } from '@/modules/users'
import Fastify from 'fastify'
import { adminRoutes } from './modules/admin'
import { astrologerRoutes } from './modules/astrologers/routes/astrologer.routes'
import { cartRoutes } from './modules/cart/routes/cart.routes'
import { categoriesRoutes } from './modules/categories/routes/categories.routes'
import { paymentRoutes } from './modules/payment/routes/payment.routes'
import { postsRoutes } from './modules/posts'
import { followsRoutes } from './modules/follows'
import { notificationsRoutes } from './modules/notifications'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => crypto.randomUUID(),
    // Fastify already logs "incoming request"/"request completed" on every
    // request via its built-in onRequest/onResponse hooks. requestLoggerPlugin
    // (registered in registerPlugins) does the exact same thing with the same
    // fields, so every request was paying for two log writes instead of one.
    disableRequestLogging: true,
  })

  // Register plugins (cors, helmet, JWT, error handlers, etc.)
  await registerPlugins(app)

  // Health check
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    },
  )

  // API routes
  const apiPrefix = `/api/${env.API_VERSION}`
  await app.register(authRoutes, { prefix: apiPrefix })
  await app.register(userRoutes, { prefix: apiPrefix })
  await app.register(consultationRoutes, { prefix: apiPrefix })
  await app.register(paymentRoutes, { prefix: apiPrefix })
  await app.register(cartRoutes, { prefix: apiPrefix })
  await app.register(astrologerRoutes, { prefix: apiPrefix })
  await app.register(postsRoutes, { prefix: apiPrefix })
  await app.register(followsRoutes, { prefix: apiPrefix })
  await app.register(notificationsRoutes, { prefix: apiPrefix })
  await app.register(categoriesRoutes, { prefix: apiPrefix })
  await app.register(adminRoutes, { prefix: apiPrefix })
  return app
}
