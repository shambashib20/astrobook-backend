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

  // Booking detail page ke liye — kisi bhi status ka request fetch karo
  getCancellationByAppointment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { appointmentId } = request.params as { appointmentId: string }
    const cancellation = await this.walletService.getCancellationByAppointment(appointmentId, userId)
    return reply.status(200).send({ success: true, data: { cancellation } })
  }

  claimCancellation = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { requestId } = request.params as { requestId: string }
    const { action, upiId } = request.body as { action: 'refund' | 'wallet'; upiId?: string }
    const result = await this.walletService.claimCancellation(requestId, userId, action, upiId)
    return reply.status(200).send({ success: true, data: { request: result } })
  }

  payWithWallet = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { appointmentId } = request.body as { appointmentId: string }
    const result = await this.walletService.payWithWallet(userId, appointmentId)
    return reply.status(200).send({ success: true, data: result })
  }

  // ── Admin handlers ─────────────────────────────────────────────────────────

  adminListRequests = async (request: FastifyRequest, reply: FastifyReply) => {
    const { filter } = request.query as { filter?: 'pending' | 'all' }
    const requests = await this.walletService.getAdminCancellationRequests(filter ?? 'pending')
    return reply.status(200).send({ success: true, data: { requests } })
  }

  adminApproveRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const { requestId } = request.params as { requestId: string }
    const result = await this.walletService.approveAdminCancellation(requestId)
    return reply.status(200).send({ success: true, data: { request: result } })
  }

  adminRejectRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const { requestId } = request.params as { requestId: string }
    const { reason } = request.body as { reason?: string }
    const result = await this.walletService.rejectAdminCancellation(requestId, reason)
    return reply.status(200).send({ success: true, data: { request: result } })
  }
}
