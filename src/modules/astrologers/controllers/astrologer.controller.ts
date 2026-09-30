// src/modules/astrologers/controllers/astrologer.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AstrologerService } from '../services/astrologer.service'
import { AstrologerListQuerySchema } from '../schemas/astrologer.schema'

export class AstrologerController {
  constructor(private readonly astrologerService: AstrologerService) {}

  getAll = async (request: FastifyRequest, reply: FastifyReply) => {
    // limit 1..100 clamp zod schema karta hai — client oversized scan force
    // nahi kar sakta.
    const query = AstrologerListQuerySchema.parse(request.query)
    const astrologers = await this.astrologerService.getAll(query)
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
