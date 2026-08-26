import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { env } from '@/config/env'

export async function swaggerPlugin(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Astrobook API',
        description: 'Supabase Auth + JWT Session Management',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: 'Local dev server',
        },
      ],
      tags: [
        { name: 'Health', description: 'Health check' },
        { name: 'Auth', description: 'Authentication & authorization' },
        { name: 'Users', description: 'User management' },
        { name: 'YouTube', description: "Astrobook's YouTube channel feed" },
        { name: 'Admin', description: 'Admin panel endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  if (env.NODE_ENV !== 'production') {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        tryItOutEnabled: true,
      },
    })
  }
}
