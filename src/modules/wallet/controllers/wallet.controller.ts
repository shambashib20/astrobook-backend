import type { FastifyRequest, FastifyReply } from 'fastify'
import type { WalletService } from '../services/wallet.service'

export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  getBalance = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const wallet = await this.walletService.getBalance(userId)
    return reply.status(200).send({ success: true, data: wallet })
  }

  getTransactions = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const transactions = await this.walletService.getTransactions(userId)
    return reply.status(200).send({ success: true, data: { transactions } })
  }

  getPendingCancellations = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const requests = await this.walletService.getPendingCancellations(userId)
    return reply.status(200).send({ success: true, data: { requests } })
  }

  claimCancellation = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { requestId } = request.params as { requestId: string }
    const { action } = request.body as { action: 'refund' | 'wallet' }
    const result = await this.walletService.claimCancellation(requestId, userId, action)
    return reply.status(200).send({ success: true, data: { request: result } })
  }

  payWithWallet = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { appointmentId } = request.body as { appointmentId: string }
    const result = await this.walletService.payWithWallet(userId, appointmentId)
    return reply.status(200).send({ success: true, data: result })
  }
}
