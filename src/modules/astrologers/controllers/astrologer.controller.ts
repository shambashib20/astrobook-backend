// src/modules/astrologers/controllers/astrologer.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AstrologerService } from '../services/astrologer.service'

export class AstrologerController {
  constructor(private readonly astrologerService: AstrologerService) {}

  getAll = async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit, offset } = request.query as { limit?: string; offset?: string }
    // Clamp so a client can't force an unbounded/oversized scan.
    const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
    const parsedOffset = Math.max(Number(offset) || 0, 0)
    const astrologers = await this.astrologerService.getAll(parsedLimit, parsedOffset)
    return reply.status(200).send({ astrologers })
  }

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const astrologer = await this.astrologerService.getById(id)
    return reply.status(200).send({ astrologer })
  }

  getServices = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const services = await this.astrologerService.getServices(id)
    return reply.status(200).send({ services })
  }

  getSlots = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const slots = await this.astrologerService.getSlots(id)
    return reply.status(200).send({ slots })
  }
}
