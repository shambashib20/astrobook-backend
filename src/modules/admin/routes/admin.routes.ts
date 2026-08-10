import { getDb } from '@/core/database/client'
import { authenticate, requireRole } from '@/modules/auth'
import type { FastifyInstance } from 'fastify'
import { AdminController } from '../controllers/admin.controller'
import { AdminRepository } from '../repositories/admin.repository'
import { AdminService } from '../services/admin.service'

export async function adminRoutes(app: FastifyInstance) {
  const db = getDb()
  const adminRepository = new AdminRepository(db)
  const adminService = new AdminService(adminRepository)
  const adminController = new AdminController(adminService)

  const prefix = '/admin'
  // Sabhi /admin/* routes sirf admin role ke liye — login zaroori hai
  const guard = [authenticate, requireRole(['admin'])]

  // GET /admin/stats — dashboard counts
  app.get(
    `${prefix}/stats`,
    {
      preHandler: guard,
      schema: { tags: ['Admin'], summary: 'Dashboard stats', security: [{ bearerAuth: [] }] },
    },
    adminController.getStats,
  )

  // GET /admin/health — system health for the admin panel (DB, cron, server)
  app.get(
    `${prefix}/health`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'System health (Neon DB, background cron jobs, server) with logs on failure',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              checks: {
                type: 'object',
                properties: {
                  server: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      uptimeSeconds: { type: 'number' },
                      memoryUsageMb: { type: 'number' },
                    },
                  },
                  database: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      latencyMs: { type: 'number' },
                      error: { type: ['string', 'null'] },
                      logs: { type: 'array' },
                    },
                  },
                  cron: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      jobs: { type: 'array' },
                      logs: { type: 'array' },
                    },
                  },
                  agora: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      reason: { type: 'string' },
                      error: { type: 'string' },
                      month: { type: 'string' },
                      totalMinutes: { type: 'number' },
                      totalHours: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    adminController.getSystemHealth,
  )

  // GET /admin/upload-token — ImageKit signed token (document uploads)
  app.get(
    `${prefix}/upload-token`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'ImageKit upload token for documents',
        security: [{ bearerAuth: [] }],
      },
    },
    adminController.getUploadToken,
  )

  // ── Users ──────────────────────────────────────────────────────────────────

  app.get(
    `${prefix}/users`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'List users (search/filter/paginate)',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            role: { type: 'string', enum: ['user', 'astrologer', 'admin'] },
            isBanned: { type: 'boolean' },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    adminController.listUsers,
  )

  app.get(
    `${prefix}/users/:id`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Get a single user',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    adminController.getUser,
  )

  app.patch(
    `${prefix}/users/:id/ban`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Ban or unban a user',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['isBanned'],
          properties: { isBanned: { type: 'boolean' }, reason: { type: 'string' } },
        },
      },
    },
    adminController.setBanStatus,
  )

  app.patch(
    `${prefix}/users/:id/role`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: "Change a user's role",
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['role'],
          properties: { role: { type: 'string', enum: ['user', 'astrologer', 'admin'] } },
        },
      },
    },
    adminController.updateUserRole,
  )

  app.delete(
    `${prefix}/users/:id`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Delete a user',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    adminController.deleteUser,
  )

  // ── Astrologers / Verification ──────────────────────────────────────────────

  app.get(
    `${prefix}/astrologers`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'List astrologers (filter by verification status)',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    adminController.listAstrologers,
  )

  app.get(
    `${prefix}/astrologers/:id`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Get a single astrologer profile',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    adminController.getAstrologer,
  )

  app.patch(
    `${prefix}/astrologers/:id/documents`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Add/update the two verification documents',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          properties: {
            document1Url: { type: 'string' },
            document2Url: { type: 'string' },
          },
        },
      },
    },
    adminController.updateDocuments,
  )

  app.patch(
    `${prefix}/astrologers/:id/commission`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: "Update an astrologer's commission percentage",
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['commissionPercentage'],
          properties: {
            commissionPercentage: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
    adminController.updateCommission,
  )

  app.patch(
    `${prefix}/astrologers/:id/verification`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Approve, reject, or reset an astrologer verification',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            rejectionReason: { type: 'string' },
          },
        },
      },
    },
    adminController.updateVerification,
  )

  // ── Posts (moderation) ──────────────────────────────────────────────────────

  app.get(
    `${prefix}/posts`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'List all posts (moderation)',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            astrologerId: { type: 'string', format: 'uuid' },
            search: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    adminController.listPosts,
  )

  app.delete(
    `${prefix}/posts/:id`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Remove a post',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    adminController.deletePost,
  )
}
