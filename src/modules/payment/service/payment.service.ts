import Razorpay from 'razorpay'
import crypto from 'crypto'
import { env } from '@/config/env'
import { BadRequestError, NotFoundError, ForbiddenError } from '@/core/errors'
import { AgoraService } from '@/modules/consultation/services/agora.service'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { PaymentRepository } from '../repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type {
  CreatePaymentOrderDto,
  VerifyPaymentDto,
} from '@/modules/consultation/schemas/consultation.schema'

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
})

export class PaymentService {
  private readonly agoraService = new AgoraService()

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  // Step 1: Create Razorpay order
  async createOrder(userId: string, dto: CreatePaymentOrderDto) {
    const { appointmentId } = dto

    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== userId) {
      throw ForbiddenError('You are not authorized to pay for this appointment')
    }

    if (appointment.status !== 'pending') {
      throw BadRequestError('Appointment is not in pending state')
    }

    // Get service price from appointment
    const appointmentWithDetails =
      await this.appointmentRepository.findByIdWithDetails(appointmentId)
    if (!appointmentWithDetails) throw NotFoundError('Appointment details not found')

    // Booking waqt ka price snapshot use karo (variant-based) — agar kisi
    // wajah se null hai (purani appointment) toh service.price pe fallback
    const amount = Number(appointmentWithDetails.price ?? appointmentWithDetails.service.price)
    if (!amount || amount <= 0) throw BadRequestError('Invalid service price')

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise mein
      currency: 'INR',
      receipt: `appt_${appointmentId.slice(0, 8)}`,
      notes: {
        appointmentId,
        userId,
      },
    })

    // Save payment record as pending
    await this.paymentRepository.create({
      appointmentId,
      razorpayOrderId: order.id,
      amount: String(amount),
      status: 'pending',
    })

    return {
      orderId: order.id,
      amount,
      currency: 'INR',
      appointmentId,
    }
  }

  // Step 2: Verify payment → confirm appointment + generate Agora token
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = dto

    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== userId) {
      throw ForbiddenError('You are not authorized to verify this payment')
    }

    // Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex')

    if (expectedSignature !== razorpaySignature) {
      // Mark payment as failed
      await this.paymentRepository.updateByOrderId(razorpayOrderId, {
        status: 'failed',
        razorpayPaymentId,
        razorpaySignature,
      })
      this.pushNotificationService.sendToUser(userId, {
        title: 'Payment Nahi Hua',
        body: 'Tumhara payment complete nahi ho paya',
        data: { type: 'payment_failed', appointmentId },
      })
      throw BadRequestError('Payment verification failed — invalid signature')
    }

    // Generate Agora token now that payment is confirmed
    const { channel, token } = this.agoraService.generateToken(appointmentId)

    // Update payment record
    const updatedPayment = await this.paymentRepository.updateByOrderId(razorpayOrderId, {
      status: 'success',
      razorpayPaymentId,
      razorpaySignature,
    })

    // Confirm appointment + set Agora credentials
    const confirmed = await this.appointmentRepository.update(appointmentId, {
      status: 'confirmed',
      agoraChannel: channel,
      agoraToken: token,
    })

    // Dono taraf notify karo
    this.pushNotificationService.sendToUser(appointment.userId, {
      title: 'Booking Confirmed!',
      body: 'Tumhari booking confirm ho gayi hai',
      data: { type: 'booking_confirmed', appointmentId },
    })
    this.pushNotificationService.sendToUser(appointment.astrologerId, {
      title: 'Naya Booking Mila',
      body: `₹${updatedPayment?.amount ?? ''} ka payment mila — naya booking confirm ho gaya`,
      data: { type: 'new_booking', appointmentId },
    })

    return {
      message: 'Payment successful',
      appointment: confirmed,
    }
  }

  // Astrologer ke apne received payments (transactions tab ke liye)
  async getAstrologerTransactions(astrologerId: string) {
    return this.paymentRepository.findByAstrologer(astrologerId)
  }
}
