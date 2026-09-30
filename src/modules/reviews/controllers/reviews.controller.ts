import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  AppointmentParamsSchema,
  AstrologerParamsSchema,
  ListReviewsQuerySchema,
  SubmitReviewSchema,
} from '../schemas/reviews.schema'
import type { ReviewsService } from '../services/reviews.service'

export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // POST /appointments/:appointmentId/review
  submit = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { appointmentId } = AppointmentParamsSchema.parse(request.params)
    const dto = SubmitReviewSchema.parse(request.body)
    const review = await this.reviewsService.submit(userId, appointmentId, dto)
    return reply.status(200).send({ success: true, data: { review } })
  }

  // DELETE /appointments/:appointmentId/review
  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { appointmentId } = AppointmentParamsSchema.parse(request.params)
    await this.reviewsService.remove(userId, appointmentId)
    return reply.send({ success: true })
  }

  // GET /reviews/mine
  listMine = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const reviews = await this.reviewsService.listMine(userId)
    return reply.send({ success: true, data: { reviews } })
  }

  // GET /astrologers/:astrologerId/reviews (public)
  listForAstrologer = async (request: FastifyRequest, reply: FastifyReply) => {
    const { astrologerId } = AstrologerParamsSchema.parse(request.params)
    const { limit, offset } = ListReviewsQuerySchema.parse(request.query)
    const data = await this.reviewsService.listForAstrologer(astrologerId, limit, offset)
    return reply.send({ success: true, data })
  }
}
