import type { FastifyRequest, FastifyReply } from 'fastify'
import type { WalletService } from '../services/wallet.service'

export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  getBalance = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id
    const wallet = await this.walletService.getBalance(userId)
    return reply.send({ wallet })
  }

  getTransactions = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id
    const transactions = await this.walletService.getTransactions(userId)
    return reply.send({ transactions })
  }

  getPendingCancellations = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).id
    const requests = await this.walletService.getPendingCancellations(userId)
    return reply.send({ requests })
  }

  claimCancellation = async (
    request: FastifyRequest<{
      Params: { requestId: string }
      Body: { action: 'refund' | 'wallet' }
    }>,
    reply: FastifyReply,
  ) => {
    const userId = (request.user as any).id
    const { requestId } = request.params
    const { action } = request.body
    const result = await this.walletService.claimCancellation(requestId, userId, action)
    return reply.send({ request: result })
  }
}
