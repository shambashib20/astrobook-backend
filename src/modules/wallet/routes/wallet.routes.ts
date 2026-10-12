import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { authenticate } from '@/modules/auth'
import { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import { PushNotificationService } from '@/core/services/push-notification.service'
import { WalletRepository } from '../repositories/wallet.repository'
import { WalletService } from '../services/wallet.service'
import { WalletController } from '../controllers/wallet.controller'

export async function walletRoutes(app: FastifyInstance) {
  const db = getDb()
  const walletRepo = new WalletRepository(db)
  const paymentRepo = new PaymentRepository(db)
  const appointmentRepo = new AppointmentRepository(db)
  const pushService = new PushNotificationService(db)
  const walletService = new WalletService(walletRepo, paymentRepo, appointmentRepo, pushService)
  const walletController = new WalletController(walletService)

  // GET /wallet/balance
  app.get(
    '/wallet/balance',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Wallet'],
        summary: 'AstroBook wallet balance',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              wallet: {
                type: 'object',
                properties: {
                  balance: { type: 'string' },
                  currency: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    walletController.getBalance,
  )

  // GET /wallet/transactions
  app.get(
    '/wallet/transactions',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Wallet'],
        summary: 'Wallet credit/debit history',
        security: [{ bearerAuth: [] }],
      },
    },
    walletController.getTransactions,
  )

  // GET /wallet/cancellation-requests/pending
  app.get(
    '/wallet/cancellation-requests/pending',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Wallet'],
        summary: 'Pending astrologer-cancellation choice requests',
        security: [{ bearerAuth: [] }],
      },
    },
    walletController.getPendingCancellations,
  )

  // POST /wallet/cancellation-requests/:requestId/claim
  app.post(
    '/wallet/cancellation-requests/:requestId/claim',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Wallet'],
        summary: 'Claim cancellation — refund ya wallet credit',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['requestId'],
          properties: {
            requestId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['refund', 'wallet'] },
          },
        },
      },
    },
    walletController.claimCancellation,
  )

  // POST /wallet/pay — appointment ko wallet se pay karke confirm karo
  app.post(
    '/wallet/pay',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['Wallet'],
        summary: 'Wallet se booking payment — balance >= price hona chahiye',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['appointmentId'],
          properties: {
            appointmentId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    walletController.payWithWallet,
  )
}
