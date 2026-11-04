import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'
import type { FastifyInstance } from 'fastify'
import { KundliController } from '../controllers/kundli.controller'
import { KundliRepository } from '../repositories/kundli.repository'
import { KundliService } from '../services/kundli.service'
import { UserRepository } from '@/modules/users/repositories/user.repository'

export async function kundliRoutes(app: FastifyInstance) {
  // ── Dependency injection ───────────────────────────────────────────────────
  const db             = getDb()
  const kundliRepo     = new KundliRepository(db)
  const userRepo       = new UserRepository(db)
  const kundliService  = new KundliService(kundliRepo, userRepo, app.log)
  const controller     = new KundliController(kundliService)

  const prefix = '/kundli'

  // ── POST /kundli/birth-details ───────────────────────────────────────────────
  // Edit Profile se birth info save karo (DOB + time + place + coords)
  app.post(
    `${prefix}/birth-details`,
    {
      preHandler: [authenticate],
      schema: {
        tags:     ['Kundli'],
        summary:  'Save birth details for Kundli generation',
        security: [{ bearerAuth: [] }],
        body: {
          type:     'object',
          required: ['birthDate', 'birthTime', 'birthPlace'],
          properties: {
            birthDate:  { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
            birthTime:  { type: 'string', pattern: '^\\d{2}:\\d{2}(:\\d{2})?$', description: 'HH:MM ya HH:MM:SS' },
            birthPlace: { type: 'string', minLength: 2, maxLength: 255 },
            birthLat:   { type: 'number', minimum: -90,  maximum: 90 },
            birthLng:   { type: 'number', minimum: -180, maximum: 180 },
          },
        },
      },
    },
    controller.saveBirthDetails,
  )

  // ── POST /kundli/generate ────────────────────────────────────────────────────
  // "Generate My Kundli" — Kundlit API call + parse + DB save
  // Body optional: agar DB mein birth details hain toh empty body bhej sakte ho
  app.post(
    `${prefix}/generate`,
    {
      preHandler: [authenticate],
      schema: {
        tags:    ['Kundli'],
        summary: 'Generate Vedic Kundli (Kundlit.com API) — takes 3-8 seconds',
        security:[{ bearerAuth: [] }],
        body: {
          type:     'object',
          properties: {
            birthDate:  { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            birthTime:  { type: 'string', pattern: '^\\d{2}:\\d{2}(:\\d{2})?$' },
            birthPlace: { type: 'string' },
            birthLat:   { type: 'number' },
            birthLng:   { type: 'number' },
          },
        },
      },
    },
    controller.generateKundli,
  )

  // ── GET /kundli/me ───────────────────────────────────────────────────────────
  // User ka apna Kundli — auth required
  app.get(
    `${prefix}/me`,
    {
      preHandler: [authenticate],
      schema: {
        tags:    ['Kundli'],
        summary: 'Get my Kundli data',
        security:[{ bearerAuth: [] }],
      },
    },
    controller.getMyKundli,
  )

  // ── GET /kundli/share/:token ─────────────────────────────────────────────────
  // Public share link — auth nahi chahiye
  app.get(
    `${prefix}/share/:token`,
    {
      schema: {
        tags:    ['Kundli'],
        summary: 'Get a publicly shared Kundli by token (no auth required)',
        params: {
          type:       'object',
          required:   ['token'],
          properties: { token: { type: 'string' } },
        },
      },
    },
    controller.getPublicKundli,
  )

  // ── PATCH /kundli/visibility ──────────────────────────────────────────────────
  // Public/private toggle — share link generate/revoke
  app.patch(
    `${prefix}/visibility`,
    {
      preHandler: [authenticate],
      schema: {
        tags:    ['Kundli'],
        summary: 'Make Kundli public or private',
        security:[{ bearerAuth: [] }],
        body: {
          type:       'object',
          required:   ['isPublic'],
          properties: { isPublic: { type: 'boolean' } },
        },
      },
    },
    controller.updateVisibility,
  )
}
