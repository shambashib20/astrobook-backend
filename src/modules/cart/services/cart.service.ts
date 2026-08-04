import Razorpay from 'razorpay'
import crypto from 'crypto'
import { env } from '@/config/env'
import { BadRequestError, NotFoundError } from '@/core/errors'
import type { CartRepository } from '../repositories/cart.repository'
import type { ServiceRepository } from '@/modules/consultation/repositories/service.repository'
import type { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type { BookingService } from '@/modules/consultation/services/booking.service'
import type { AgoraService } from '@/modules/consultation/services/agora.service'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { AddCartItemDto, CartCheckoutVerifyDto } from '../schemas/cart.schema'

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
})

export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly serviceRepository: ServiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly bookingService: BookingService,
    private readonly agoraService: AgoraService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  // ── Add / List / Remove ────────────────────────────────────────────────────

  async addItem(userId: string, dto: AddCartItemDto) {
    const service = await this.serviceRepository.findById(dto.serviceId)
    if (!service) throw NotFoundError('Service not found')
    if (service.astrologerId !== dto.astrologerId) {
      throw BadRequestError('Service does not belong to the specified astrologer')
    }
    if (userId === dto.astrologerId) {
      throw BadRequestError('You cannot add your own service to cart')
    }

    // Variant validate karo — na diya ho toh service ka default (30-min) variant
    let variantId = dto.variantId
    if (variantId) {
      const variant = await this.serviceRepository.findVariantById(variantId)
      if (!variant || variant.serviceId !== dto.serviceId) {
        throw BadRequestError('Variant does not belong to the specified service')
      }
    } else {
      const defaultVariant = await this.serviceRepository.findDefaultVariant(dto.serviceId)
      variantId = defaultVariant?.id
    }

    return this.cartRepository.create({
      userId,
      astrologerId: dto.astrologerId,
      serviceId: dto.serviceId,
      variantId: variantId ?? null,
      scheduledAt: null,
    })
  }

  // Cart list ke saath service details (title, price, duration, coverImage,
  // isBasic) enrich karke bhejte hain — frontend ko alag se fetch na karna
  // pade. Variant select hui ho toh uska duration/price service ke defaults
  // ko override kar deta hai (jo variant chuna wahi dikhna/charge hona chahiye).
  async getMyCart(userId: string) {
    const items = await this.cartRepository.findMine(userId)
    const serviceIds = Array.from(new Set(items.map((i) => i.serviceId)))
    const variantIds = Array.from(
      new Set(items.map((i) => i.variantId).filter((id): id is string => !!id)),
    )
    const [services, variants] = await Promise.all([
      this.serviceRepository.findByIds(serviceIds),
      this.serviceRepository.findVariantsByIds(variantIds),
    ])
    const serviceMap = new Map(services.map((s) => [s.id, s]))
    const variantMap = new Map(variants.map((v) => [v.id, v]))

    return items.map((item) => {
      const service = serviceMap.get(item.serviceId) ?? null
      const variant = item.variantId ? (variantMap.get(item.variantId) ?? null) : null
      return {
        ...item,
        service: service
          ? {
              ...service,
              // Variant ke duration/price override karte hain — cart card
              // pe wahi dikhna chahiye jo user ne select kiya tha
              durationMinutes: variant?.durationMinutes ?? service.durationMinutes,
              price: variant?.price ?? service.price,
            }
          : null,
        variant,
      }
    })
  }

  async setSlot(id: string, userId: string, scheduledAt: string) {
    const parsed = new Date(scheduledAt)
    if (isNaN(parsed.getTime())) throw BadRequestError('Invalid scheduledAt datetime')
    const item = await this.cartRepository.setSlot(id, userId, parsed)
    if (!item) throw NotFoundError('Cart item not found')
    return item
  }

  async removeItem(id: string, userId: string) {
    await this.cartRepository.delete(id, userId)
  }

  // ── Checkout: Step 1 — Create combined Razorpay order ──────────────────────
  //
  // Har selected cart item ke liye ek 'pending' appointment banate hain
  // (BookingService.initiateBooking reuse karke — same availability/conflict
  // validation jo single-booking flow mein hoti hai). Fir sabke total price
  // ka EK combined Razorpay order banate hain. Har appointment ke liye ek
  // `payments` row banti hai, sabme same razorpayOrderId — taaki verify step
  // par sab ek saath confirm ho saken.

  async createCheckoutOrder(userId: string, cartItemIds: string[]) {
    const items = await this.cartRepository.findByIdsForUser(cartItemIds, userId)
    if (items.length === 0) throw NotFoundError('Cart items not found')
    if (items.length !== cartItemIds.length) {
      throw BadRequestError('Kuch cart items nahi mile ya tumhare nahi hain')
    }

    const withoutSlot = items.filter((i) => !i.scheduledAt)
    if (withoutSlot.length > 0) {
      throw BadRequestError('Kuch items ka slot select nahi hua hai — pehle slot pick karo')
    }

    const serviceIds = Array.from(new Set(items.map((i) => i.serviceId)))
    const services = await this.serviceRepository.findByIds(serviceIds)
    const serviceMap = new Map(services.map((s) => [s.id, s]))

    // Har item ke liye pending appointment banao (existing validation reuse)
    // — variantId pass karte hain taaki sahi duration/price se booking bane.
    const appointments = []
    for (const item of items) {
      const service = serviceMap.get(item.serviceId)
      if (!service) throw NotFoundError(`Service ${item.serviceId} not found`)
      const appointment = await this.bookingService.initiateBooking(userId, {
        astrologerId: item.astrologerId,
        serviceId: item.serviceId,
        variantId: item.variantId ?? undefined,
        scheduledAt: item.scheduledAt!.toISOString(),
      })
      // appointment.price variant se snapshot ho chuka hai initiateBooking mein
      appointments.push({ appointment, price: Number(appointment.price) || 0 })
    }

    const totalAmount = appointments.reduce((sum, a) => sum + a.price, 0)
    if (totalAmount <= 0) throw BadRequestError('Invalid total amount')

    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100),
      currency: 'INR',
      receipt: `cart_${userId.slice(0, 8)}_${Date.now()}`,
      notes: { userId, itemCount: String(appointments.length) },
    })

    // Har appointment ke liye ek payment row — sab same razorpayOrderId share karte hain
    for (const { appointment, price } of appointments) {
      await this.paymentRepository.create({
        appointmentId: appointment.id,
        razorpayOrderId: order.id,
        amount: String(price),
        status: 'pending',
      })
    }

    // Ab yeh cart items "graduate" ho chuke hain appointments mein — cart se hata do
    await this.cartRepository.deleteMany(
      items.map((i) => i.id),
      userId,
    )

    return {
      orderId: order.id,
      amount: totalAmount,
      currency: 'INR',
      appointmentIds: appointments.map((a) => a.appointment.id),
    }
  }

  // ── Checkout: Step 2 — Verify combined payment ──────────────────────────────

  async verifyCheckout(userId: string, dto: CartCheckoutVerifyDto) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = dto

    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex')

    if (expectedSignature !== razorpaySignature) {
      await this.paymentRepository.updateByOrderId(razorpayOrderId, {
        status: 'failed',
        razorpayPaymentId,
        razorpaySignature,
      })
      this.pushNotificationService.sendToUser(userId, {
        title: 'Payment Nahi Hua',
        body: 'Tumhara payment complete nahi ho paya',
        data: { type: 'payment_failed' },
      })
      throw BadRequestError('Payment verification failed — invalid signature')
    }

    await this.paymentRepository.updateByOrderId(razorpayOrderId, {
      status: 'success',
      razorpayPaymentId,
      razorpaySignature,
    })

    const paymentRows = await this.paymentRepository.findAllByOrderId(razorpayOrderId)
    const ownedAppointments = []
    for (const row of paymentRows) {
      const appointment = await this.appointmentRepository.findById(row.appointmentId)
      if (!appointment || appointment.userId !== userId) continue // safety check
      const { channel, token } = this.agoraService.generateToken(appointment.id)
      const confirmed = await this.appointmentRepository.update(appointment.id, {
        status: 'confirmed',
        agoraChannel: channel,
        agoraToken: token,
      })
      ownedAppointments.push(confirmed)

      // Dono taraf notify karo — user ko confirm, astrologer ko naya booking + payment
      this.pushNotificationService.sendToUser(appointment.userId, {
        title: 'Booking Confirmed!',
        body: 'Tumhari booking confirm ho gayi hai',
        data: { type: 'booking_confirmed', appointmentId: appointment.id },
      })
      this.pushNotificationService.sendToUser(appointment.astrologerId, {
        title: 'Naya Booking Mila',
        body: `₹${row.amount} ka payment mila — naya booking confirm ho gaya`,
        data: { type: 'new_booking', appointmentId: appointment.id },
      })
    }

    return {
      message: 'Payment successful',
      appointments: ownedAppointments,
    }
  }
}
