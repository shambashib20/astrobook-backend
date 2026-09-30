import { getDb } from '@/core/database/client'
import { authenticate, requireRole } from '@/modules/auth'
import type { FastifyInstance } from 'fastify'
import { AdminController } from '../controllers/admin.controller'
import { AdminRepository } from '../repositories/admin.repository'
import { AdminService } from '../services/admin.service'
import { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import { TransactionRepository } from '@/modules/payment/repositories/transaction.repository'
import { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import { PushNotificationService } from '@/core/services/push-notification.service'

export async function adminRoutes(app: FastifyInstance) {
  const db = getDb()
  const adminRepository = new AdminRepository(db)
  const paymentRepository = new PaymentRepository(db)
  const transactionRepository = new TransactionRepository(db)
  const appointmentRepository = new AppointmentRepository(db)
  const pushNotificationService = new PushNotificationService(db)
  const adminService = new AdminService(
    adminRepository,
    paymentRepository,
    appointmentRepository,
    pushNotificationService,
    transactionRepository,
  )
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
        summary: 'List astrologers — filter by verification status',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            // Cashfree reconciliation filter — commented out during the
            // Razorpay rollback (kept, not deleted, for a quick re-migration).
            // cashfreeStatus: { type: 'string', enum: ['onboarded', 'not_onboarded'] },
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

  // POST /admin/astrologers/:id/cashfree-refresh — commented out during the
  // Razorpay rollback (kept, not deleted, for a quick re-migration).
  // app.post(`${prefix}/astrologers/:id/cashfree-refresh`, ..., adminController.refreshVendorStatus)

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

  // GET /admin/payments/refunds-pending + POST /admin/payments/:paymentId/refund
  // — Cashfree split-aware refund flow, commented out during the Razorpay
  // rollback (kept, not deleted, for a quick re-migration).
  // app.get(`${prefix}/payments/refunds-pending`, ..., adminController.listPendingRefunds)
  // app.post(`${prefix}/payments/:paymentId/refund`, ..., adminController.approveRefund)

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

  // ── Transactions / Payment Reconciliation ───────────────────────────────────
  // Two endpoints:
  //   /admin/transactions      → current payment states (one row per payment)
  //   /admin/transaction-events → immutable event log (one row per webhook event)

  app.get(
    `${prefix}/transactions`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Full payment transaction ledger — search, filter, paginate for reconciliation',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            status: { type: 'string', enum: ['pending', 'success', 'failed', 'refunded'] },
            userId: { type: 'string', format: 'uuid' },
            astrologerId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              transactions: { type: 'array', items: { type: 'object', additionalProperties: true } },
              pagination: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  totalPages: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    adminController.listTransactions,
  )

  app.get(
    `${prefix}/transaction-events`,
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Immutable payment event log — drill into any order for dispute resolution',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            event: {
              type: 'string',
              enum: ['order.created', 'payment.captured', 'payment.failed', 'payment.refunded', 'verify.success', 'verify.failed'],
            },
            userId: { type: 'string', format: 'uuid' },
            astrologerId: { type: 'string', format: 'uuid' },
            razorpayOrderId: { type: 'string' },
            appointmentId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              events: { type: 'array', items: { type: 'object', additionalProperties: true } },
              pagination: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  totalPages: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    adminController.listTransactionEvents,
  )
}
