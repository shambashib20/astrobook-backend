import type { FastifyRequest, FastifyReply } from 'fastify'
import type { BookingService } from '../services/booking.service'
import { CreateBookingSchema } from '../schemas/consultation.schema'

export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  // POST /consultation/appointments/initiate
  initiateBooking = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const dto = CreateBookingSchema.parse(request.body)
    const appointment = await this.bookingService.initiateBooking(userId, dto)
    return reply.status(201).send({
      success: true,
      data: { appointment },
    })
  }

  // GET /consultation/appointments/mine
  getMyAppointments = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const appointments = await this.bookingService.getMyAppointments(userId)
    return reply.status(200).send({ success: true, data: appointments })
  }

  // GET /consultation/appointments/:id
  getAppointmentById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    const appointment = await this.bookingService.getAppointmentById(id, userId)
    return reply.status(200).send({ success: true, data: { appointment } })
  }

  // PATCH /consultation/appointments/:id/cancel
  cancelAppointment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.bookingService.cancelAppointment(id, userId)
    return reply.status(200).send({ success: true })
  }

  // POST /consultation/appointments/:id/join
  joinSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    const result = await this.bookingService.joinSession(id, userId)
    return reply.status(200).send({ success: true, data: result })
  }

  // POST /consultation/appointments/:id/end
  endSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    const appointment = await this.bookingService.endSession(id, userId)
    return reply.status(200).send({ success: true, data: { appointment } })
  }

  // POST /consultation/appointments/:id/renew-token
  renewAgoraToken = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { id } = request.params as { id: string }
    const agora = await this.bookingService.renewAgoraToken(id, userId)
    return reply.status(200).send({ success: true, data: { agora } })
  }
}