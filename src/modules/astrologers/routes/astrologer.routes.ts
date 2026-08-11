// src/modules/astrologers/routes/astrologer.routes.ts
import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { AstrologerRepository } from '../repositories/astrologer.repository'
import { AstrologerService } from '../services/astrologer.service'
import { AstrologerController } from '../controllers/astrologer.controller'

export async function astrologerRoutes(app: FastifyInstance) {
  const db = getDb()

  const astrologerRepo = new AstrologerRepository(db)
  const astrologerService = new AstrologerService(astrologerRepo)
  const astrologerController = new AstrologerController(astrologerService)

  // GET /astrologers
  app.get(
    '/astrologers',
    {
      schema: {
        tags: ['Astrologers'],
        summary: 'Get all astrologers',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    astrologerController.getAll,
  )

  // GET /astrologers/:id
  app.get(
    '/astrologers/:id',
    {
      schema: {
        tags: ['Astrologers'],
        summary: 'Get astrologer by ID',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    astrologerController.getById,
  )

  // GET /astrologers/:id/services
  app.get(
    '/astrologers/:id/services',
    {
      schema: {
        tags: ['Astrologers'],
        summary: 'Get all active services of an astrologer',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              services: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
    astrologerController.getServices,
  )

  // GET /astrologers/:id/slots
  app.get(
    '/astrologers/:id/slots',
    {
      schema: {
        tags: ['Astrologers'],
        summary: 'Get upcoming availability slots of an astrologer',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              slots: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
    astrologerController.getSlots,
  )
}
