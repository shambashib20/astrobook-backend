import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/core/errors'
import { PENDING_BOOKING_TIMEOUT_MS } from '@/core/utils/cron-heartbeat'
import type { AppointmentRepository } from '../repositories/appointment.repository'
import type { ConsultationService } from './consultation.service'
import type { AgoraService } from './agora.service'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { PaymentRepository } from '@/modules/payment/repositories/payment.repositary'
import type { WalletRepository } from '@/modules/wallet/repositories/wallet.repository'
import type { CreateBookingDto } from '../schemas/consultation.schema'
import type { Appointment } from '@/core/database/schema'
import { CANCELLATION_CHOICE_WINDOW_MS } from '@/core/database/schema'

// Booking banane ke 10 minute tak FREE cancel window — koi deduction nahi.
// Iske baad cancel kiya toh ₹50 processing fee lagegi.
const FREE_CANCEL_WINDOW_MS = 10 * 60 * 1000  // 10 minutes
const CANCEL_DEDUCTION_AMOUNT = 50             // ₹50 after free window
const USER_CHOICE_WINDOW_MS = 24 * 60 * 60 * 1000 // 1 day to choose refund type

// Reschedule per-week limit: 1; per-month limit: 2
const RESCHEDULE_WEEKLY_LIMIT = 1
const RESCHEDULE_MONTHLY_LIMIT = 2

// ─── UTC Helper ───────────────────────────────────────────────────────────────

function toUtcTimestamp(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const [hours, minutes] = timeStr.split(':').map(Number) as [number, number]
  const wrongUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0)
  const wrongUtcDate = new Date(wrongUtcMs)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(wrongUtcDate).map((p) => [p.type, p.value]))
  const localHour = Number(parts['hour']) === 24 ? 0 : Number(parts['hour'])
  const wrongLocalMs = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    localHour,
    Number(parts['minute']),
    Number(parts['second']),
  )
  return new Date(wrongUtcMs - (wrongLocalMs - wrongUtcMs))
}

function shiftDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().split('T')[0]!
}

// ─── BookingService ───────────────────────────────────────────────────────────

// Scheduled time se kitne minute pehle join allowed hai
// NOTE: frontend apna khud ka 5-min "countdown dikhana shuru karo" constant
// rakhta hai UI ke liye — backend ka gate hamesha exact scheduledAt hai,
// isliye yahan koi grace-minute constant ki zarurat nahi.
export class BookingService {
  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly consultationService: ConsultationService,
    private readonly agoraService: AgoraService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly paymentRepository: PaymentRepository,
    private readonly walletRepository: WalletRepository,
  ) {}

  // ── Initiate Booking (pending — payment abhi baki) ────────────────────────

  async initiateBooking(userId: string, dto: CreateBookingDto): Promise<Appointment> {
    const { astrologerId, serviceId, variantId, scheduledAt: scheduledAtIso, notes } = dto

    if (userId === astrologerId) {
      throw BadRequestError('You cannot book a consultation with yourself')
    }

    const service = await this.consultationService.getServiceForBooking(serviceId, astrologerId)

    // Duration/price ab variant se aate hain — agar variantId nahi diya
    // (purana client / backward-compat) toh service ka default (30-min)
    // variant use ho jaata hai.
    const variant = variantId
      ? await this.consultationService.getVariantForBooking(serviceId, variantId, astrologerId)
      : await this.consultationService.getDefaultVariant(serviceId)

    const scheduledAt = new Date(scheduledAtIso)
    if (isNaN(scheduledAt.getTime())) throw BadRequestError('Invalid scheduledAt datetime')

    // Availability check — us din ke saare windows mein se kisi ek ke andar
    // scheduledAt aana chahiye (astrologer ke multiple time slots ho sakte hain).
    // scheduledAtIso ek UTC timestamp hai, isliye sirf uska date-part slice karna
    // galat hai — astrologer ka local calendar date UTC date se ek din aage/peeche
    // ho sakta hai (e.g. 3 AM IST = pichhle din ka UTC). Isliye UTC date ke aas-paas
    // ke teeno candidate dates check karte hain aur actual timestamp match se decide
    // karte hain ki slot kis window ke andar aata hai.
    const utcDate = scheduledAtIso.split('T')[0]!
    const candidateDates = [utcDate, shiftDate(utcDate, -1), shiftDate(utcDate, 1)]
    const availWindowsByDate = await Promise.all(
      candidateDates.map((d) => this.consultationService.getAvailabilityForDate(astrologerId, d)),
    )
    const availWindows = availWindowsByDate.flat()
    if (availWindows.length === 0) {
      throw BadRequestError(`Astrologer not available on ${utcDate}`)
    }

    const matchingWindow = availWindows.find((w) => {
      const windowStart = toUtcTimestamp(w.date, w.startTime, w.timezone)
      const windowEnd = toUtcTimestamp(w.date, w.endTime, w.timezone)
      return scheduledAt >= windowStart && scheduledAt < windowEnd
    })

    if (!matchingWindow) {
      throw BadRequestError('Requested slot is outside astrologer availability window')
    }

    const durationMs = variant.durationMinutes * 60 * 1000
    const endsAt = new Date(scheduledAt.getTime() + durationMs)

    // Slot conflict check
    const existing = await this.appointmentRepository.findConfirmedByAstrologerInRange(
      astrologerId,
      scheduledAt,
      endsAt,
    )
    if (existing.length > 0) throw BadRequestError('This slot is already booked')

    // Appointment create karo (pending) — price yahin snapshot ho jaata hai
    // taaki baad mein astrologer variant ka price change kare toh bhi is
    // booking ka amount wahi rahe jo booking ke waqt tha.
    const appointment = await this.appointmentRepository.create({
      astrologerId,
      userId,
      serviceId,
      variantId: variant.id,
      scheduledAt,
      endsAt,
      durationMinutes: variant.durationMinutes,
      price: variant.price,
      status: 'pending',
      notes: notes ?? null,
    })

    return appointment
  }

  // ── Confirm Booking (after payment webhook) ───────────────────────────────

  async confirmBooking(appointmentId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')
    if (appointment.status !== 'pending') {
      throw BadRequestError(`Cannot confirm appointment with status: ${appointment.status}`)
    }
    const updated = await this.appointmentRepository.update(appointmentId, { status: 'confirmed' })
    return updated!
  }

  // ── Join Session → Agora token generate ───────────────────────────────────

  async joinSession(appointmentId: string, requesterId: string) {
    // Pehle timed-out sessions ko complete kar do — stale 'ongoing' status
    // rehne se galat state mein join allow ho sakta tha
    await this.appointmentRepository.completeTimedOutSessions()

    const appointment = await this.appointmentRepository.findByIdWithDetails(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== requesterId && appointment.astrologerId !== requesterId) {
      throw ForbiddenError('You are not part of this session')
    }

    if (appointment.status === 'cancelled') throw BadRequestError('Appointment is cancelled')
    if (appointment.status === 'completed') throw BadRequestError('Session already completed')

    const isAstrologer = requesterId === appointment.astrologerId
    const now = new Date()

    // Simplify: dono astrologer aur user ko EXACT same time-gate — koi
    // early "green room" access nahi (pehle astrologer ko 5 min pehle mil
    // jaata tha, jo confusing tha — asymmetric aur user ko lagta"kyun mujhe
    // wait karna pada"). Ab dono ke liye ek hi rule: scheduled time se
    // pehle koi bhi real join nahi kar sakta.
    if (now < appointment.scheduledAt) {
      const minutesLeft = Math.ceil(
        (appointment.scheduledAt.getTime() - now.getTime()) / 60000,
      )
      throw BadRequestError(
        `Session abhi shuru nahi hua — ${minutesLeft} minute baad shuru hoga`,
      )
    }

    // User ko safety ke liye astrologer ka wait karna padta hai (taaki
    // akele call mein na baithe) — lekin ab ye sirf chand seconds ka gap
    // hota hai (dono ka gate scheduledAt hi hai), koi 5-min asymmetric
    // wait nahi. Frontend isko error-alert ki jagah "waiting..." state
    // ki tarah treat karta hai aur khud-b-khud retry karta hai.
    if (!isAstrologer && !appointment.astrologerJoinedAt) {
      throw ConflictError('Astrologer session mein aa rahi hai — thodi der wait karo')
    }

    // Agora token generate karo
    const { channel, token } = this.agoraService.generateToken(appointmentId)

    // ongoing mark karo (pehli baar join pe)
    if (appointment.status === 'confirmed') {
      await this.appointmentRepository.update(appointmentId, {
        status: 'ongoing',
        agoraChannel: channel,
        agoraToken: token,
        ...(isAstrologer ? { astrologerJoinedAt: now } : {}),
      })

      // Doosri party ko batao ki session shuru ho chuka hai, wait ho raha hai
      const otherPartyId =
        requesterId === appointment.userId ? appointment.astrologerId : appointment.userId
      this.pushNotificationService.sendToUser(otherPartyId, {
        title: 'Session Shuru Ho Gaya',
        body: 'Doosri party tumhara wait kar rahi hai — session join karo',
        data: { type: 'session_waiting', appointmentId },
      })
    } else if (isAstrologer && !appointment.astrologerJoinedAt) {
      // Rare edge case: status pehle se 'ongoing' hai (e.g. astrologer ne
      // dobara app khola/reconnect kiya) lekin astrologerJoinedAt kisi
      // wajah se set nahi hua tha — abhi bhi set kar do taaki user ka gate
      // kabhi hamesha ke liye locked na reh jaaye
      await this.appointmentRepository.update(appointmentId, { astrologerJoinedAt: now })
    }

    return {
      appointment,
      agora: { channel, token },
    }
  }

  // ── End Session ────────────────────────────────────────────────────────────

  async endSession(appointmentId: string, requesterId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== requesterId && appointment.astrologerId !== requesterId) {
      throw ForbiddenError('You are not part of this session')
    }

    // Sirf astrologer session poori tarah end kar sakta hai. User agar
    // beech mein nikal jaaye (galti se app close ho jaaye, ya "Leave" tap
    // kare) toh session "ongoing" hi rehta hai — user dobara isi booking
    // se rejoin kar sakta hai jab tak astrologer end na kare ya duration
    // khatam na ho jaaye (background cron sweep automatically complete
    // kar dega tab).
    if (appointment.astrologerId !== requesterId) {
      throw ForbiddenError('Sirf astrologer session end kar sakta hai')
    }

    if (appointment.status !== 'ongoing') {
      throw BadRequestError('Session is not ongoing')
    }

    const updated = await this.appointmentRepository.update(appointmentId, { status: 'completed' })
    return updated!
  }

  // ── Renew Agora Token ──────────────────────────────────────────────────────
  //
  // Token 1 hour (3600s) ke baad expire ho jaata hai, lekin service variants
  // 90 min tak ke hote hain — isliye lambe sessions mein token beech mein hi
  // expire ho sakta tha aur call drop ho jaati thi. App `onTokenPrivilegeWillExpire`
  // (expiry se ~30s pehle) pe ye call karta hai, hum same channel ka naya
  // token bana ke de dete hain — engine.renewToken() se call bina disconnect
  // ke chalti rehti hai.

  async renewAgoraToken(appointmentId: string, requesterId: string) {
    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== requesterId && appointment.astrologerId !== requesterId) {
      throw ForbiddenError('You are not part of this session')
    }

    if (appointment.status !== 'ongoing') {
      throw BadRequestError('Session is not ongoing — cannot renew token')
    }

    // Channel naam appointmentId se hi deterministically banta hai
    // (agora.service.ts dekho), isliye naya token bhi same channel ke liye
    // banega — dono party same channel pe rehte hain, koi rejoin nahi chahiye.
    const { channel, token } = this.agoraService.generateToken(appointmentId)
    return { channel, token }
  }

  // ── Get Appointments ───────────────────────────────────────────────────────

  async getMyAppointments(userId: string) {
    await this.appointmentRepository.completeTimedOutSessions()
    return this.appointmentRepository.findMineGrouped(userId)
  }

  async getAppointmentById(id: string, requesterId: string) {
    await this.appointmentRepository.completeTimedOutSessions()
    const appointment = await this.appointmentRepository.findByIdWithDetails(id)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== requesterId && appointment.astrologerId !== requesterId) {
      throw ForbiddenError('You are not authorized to view this appointment')
    }

    const children =
      appointment.parentId === null ? await this.appointmentRepository.findChildren(id) : []

    return { ...appointment, children }
  }

  async cancelAppointment(appointmentId: string, requesterId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findById(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')

    if (appointment.userId !== requesterId && appointment.astrologerId !== requesterId) {
      throw ForbiddenError('You are not authorized to cancel this appointment')
    }

    if (appointment.status === 'cancelled') throw BadRequestError('Already cancelled')
    if (appointment.status === 'completed')
      throw BadRequestError('Cannot cancel a completed appointment')
    if (appointment.status === 'ongoing') throw BadRequestError('Cannot cancel an ongoing session')

    const wasConfirmedPaid = appointment.status === 'confirmed'
    const isAstrologerCancelling = requesterId === appointment.astrologerId

    // ── User cancel: koi time-based block nahi — sirf deduction rule ────────
    // Booking ke 10 min ke andar → ₹0 deduction (full refund)
    // Iske baad → ₹50 processing fee

    // Appointment cancel karo
    const updated = await this.appointmentRepository.update(appointmentId, {
      status: 'cancelled',
      cancelledBy: isAstrologerCancelling ? 'astrologer' : 'user',
    })

    // Refund logic — sirf jab booking CONFIRMED (paid) thi
    if (wasConfirmedPaid) {
      const payment = await this.paymentRepository.findByAppointmentId(appointmentId)

      if (isAstrologerCancelling) {
        // ── Astrologer cancel ────────────────────────────────────────────────
        // Hamesha full refund — deduction nahi. User ko 1 din ka window dete
        // hain choose karne ke liye (money refund ya wallet credit). Admin approve karega.
        if (payment?.status === 'success') {
          const expiresAt = new Date(Date.now() + USER_CHOICE_WINDOW_MS)
          await this.walletRepository.createCancellationRequest({
            appointmentId,
            userId: appointment.userId,
            amount: payment.amount,
            razorpayPaymentId: payment.razorpayPaymentId ?? undefined,
            razorpayOrderId: payment.razorpayOrderId ?? undefined,
            deductionAmount: 0,
            initiatedBy: 'astrologer',
            expiresAt,
          })

          this.pushNotificationService.sendToUser(appointment.userId, {
            title: 'Astrologer Ne Cancel Kiya',
            body: 'Refund ya wallet credit — 1 din mein choose karo',
            data: { type: 'astrologer_cancelled_choice', appointmentId },
          })
        }
      } else {
        // ── User cancel ──────────────────────────────────────────────────────
        // 10 min ke andar → ₹0 deduction; baad mein → ₹50 deduction.
        // Dono cases mein cancellation_request create hoti hai — admin queue.
        if (payment?.status === 'success') {
          const msSinceBooking = Date.now() - new Date(appointment.createdAt).getTime()
          const deductionAmount = msSinceBooking <= FREE_CANCEL_WINDOW_MS ? 0 : CANCEL_DEDUCTION_AMOUNT
          const expiresAt = new Date(Date.now() + USER_CHOICE_WINDOW_MS)

          await this.walletRepository.createCancellationRequest({
            appointmentId,
            userId: appointment.userId,
            amount: payment.amount,
            razorpayPaymentId: payment.razorpayPaymentId ?? undefined,
            razorpayOrderId: payment.razorpayOrderId ?? undefined,
            deductionAmount,
            initiatedBy: 'user',
            expiresAt,
          })

          const bodyMsg = deductionAmount > 0
            ? `₹${deductionAmount} processing fee lagegi — refund ya wallet credit choose karo (1 din ka time hai)`
            : 'Refund ya wallet credit — 1 din mein choose karo'

          this.pushNotificationService.sendToUser(requesterId, {
            title: 'Booking Cancel Ho Gayi',
            body: bodyMsg,
            data: { type: 'user_cancelled_choice', appointmentId },
          })
        } else {
          // Unpaid / payment not found
          this.pushNotificationService.sendToUser(requesterId, {
            title: 'Booking Cancel Ho Gayi',
            body: 'Tumhari booking cancel ho gayi hai',
            data: { type: 'booking_cancelled_self', appointmentId, refunded: 'false' },
          })
        }

        // Astrologer ko bhi batao
        this.pushNotificationService.sendToUser(appointment.astrologerId, {
          title: 'Booking Cancelled',
          body: 'User ne ek booking cancel kar di hai',
          data: { type: 'booking_cancelled', appointmentId },
        })
      }
    } else {
      // Unpaid cancel — dono ko simple notify
      const otherPartyId =
        requesterId === appointment.userId ? appointment.astrologerId : appointment.userId
      this.pushNotificationService.sendToUser(otherPartyId, {
        title: 'Booking Cancelled',
        body: 'Tumhari ek booking cancel ho gayi hai',
        data: { type: 'booking_cancelled', appointmentId },
      })
    }

    return updated!
  }

  // ── Stale pending booking cleanup (cron-triggered, no requester) ──────────
  // Payment kabhi shuru hi nahi hui ya beech mein chhod di gayi, aur itni der
  // ho gayi ki ab genuine slow-payment nahi maani ja sakti. Cancel karke slot
  // wapas release karo, aur agar order create ho chuka tha to us payment row
  // ko bhi 'failed' mark karo (clean bookkeeping).
  async cancelStalePendingBookings(): Promise<number> {
    const cutoff = new Date(Date.now() - PENDING_BOOKING_TIMEOUT_MS)
    const stale = await this.appointmentRepository.findStalePending(cutoff)

    for (const appointment of stale) {
      await this.appointmentRepository.update(appointment.id, { status: 'cancelled' })
      await this.paymentRepository.markFailedByAppointmentId(appointment.id)

      this.pushNotificationService.sendToUser(appointment.userId, {
        title: 'Booking Expire Ho Gayi',
        body: 'Payment complete na hone ki wajah se tumhari pending booking cancel ho gayi hai — dobara book kar sakte ho',
        data: { type: 'booking_expired', appointmentId: appointment.id },
      })
    }

    return stale.length
  }

  // ── Reschedule Appointment (user-initiated, same astrologer + service) ──────
  // User ek cancelled appointment ke badle naya slot choose karta hai.
  // Limits: 1 per booking | 1 per week | 2 per month.

  async rescheduleAppointment(appointmentId: string, userId: string, newScheduledAtIso: string) {
    const appointment = await this.appointmentRepository.findByIdWithDetails(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')
    if (appointment.userId !== userId) throw ForbiddenError('Not your appointment')
    if (appointment.status !== 'cancelled') {
      throw BadRequestError('Sirf cancelled booking hi reschedule ho sakti hai')
    }

    // Per-booking limit: sirf ek baar reschedule allowed
    if ((appointment as any).rescheduledCount >= 1) {
      throw BadRequestError('Yeh booking pehle se ek baar reschedule ho chuki hai')
    }

    // Weekly limit check
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const weeklyCount = await this.walletRepository.countTimingChangesSince(userId, oneWeekAgo)
    if (weeklyCount >= RESCHEDULE_WEEKLY_LIMIT) {
      throw BadRequestError('Is hafte tumhara reschedule limit ho gaya hai (1 per week)')
    }

    // Monthly limit check
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const monthlyCount = await this.walletRepository.countTimingChangesSince(userId, oneMonthAgo)
    if (monthlyCount >= RESCHEDULE_MONTHLY_LIMIT) {
      throw BadRequestError('Is mahine tumhara reschedule limit ho gaya hai (2 per month)')
    }

    // New slot validation
    const newScheduledAt = new Date(newScheduledAtIso)
    if (isNaN(newScheduledAt.getTime())) throw BadRequestError('Invalid scheduledAt datetime')
    if (newScheduledAt <= new Date()) throw BadRequestError('Naya slot future mein hona chahiye')

    // Availability check for new slot
    const utcDate = newScheduledAtIso.split('T')[0]!
    const candidateDates = [utcDate, shiftDate(utcDate, -1), shiftDate(utcDate, 1)]
    const availWindowsByDate = await Promise.all(
      candidateDates.map((d) =>
        this.consultationService.getAvailabilityForDate(appointment.astrologerId, d),
      ),
    )
    const availWindows = availWindowsByDate.flat()

    const matchingWindow = availWindows.find((w) => {
      const windowStart = toUtcTimestamp(w.date, w.startTime, w.timezone)
      const windowEnd = toUtcTimestamp(w.date, w.endTime, w.timezone)
      return newScheduledAt >= windowStart && newScheduledAt < windowEnd
    })
    if (!matchingWindow) {
      throw BadRequestError('Naya slot astrologer ki availability ke bahar hai')
    }

    const durationMs = appointment.durationMinutes * 60 * 1000
    const newEndsAt = new Date(newScheduledAt.getTime() + durationMs)

    // Conflict check (other confirmed bookings, excluding self)
    const conflicts = await this.appointmentRepository.findConflictsExcluding(
      appointment.astrologerId,
      newScheduledAt,
      newEndsAt,
      appointmentId,
    )
    if (conflicts.length > 0) throw BadRequestError('Yeh slot already book hai')

    // Pending cancellation_request close karo (timing_changed)
    const pendingReq = await this.walletRepository.findPendingByAppointment(appointmentId)
    if (pendingReq) {
      await this.walletRepository.updateStatus(pendingReq.id, 'timing_changed')
    }

    // Appointment update — new slot + status confirmed + rescheduledCount++
    const updated = await this.appointmentRepository.update(appointmentId, {
      scheduledAt: newScheduledAt,
      endsAt: newEndsAt,
      status: 'confirmed',
      rescheduledCount: ((appointment as any).rescheduledCount ?? 0) + 1,
    })

    // Notifications
    this.pushNotificationService.sendToUser(userId, {
      title: 'Booking Reschedule Ho Gayi',
      body: `Naya session: ${newScheduledAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
      data: { type: 'booking_rescheduled', appointmentId },
    })
    this.pushNotificationService.sendToUser(appointment.astrologerId, {
      title: 'Booking Reschedule Ho Gayi',
      body: 'User ne apna slot change kar liya — naya time dekho',
      data: { type: 'booking_rescheduled', appointmentId },
    })

    return { appointment: updated }
  }

  // ── Astrologer Schedule ────────────────────────────────────────────────────

  async getSchedule(astrologerId: string, date: string) {
    return this.appointmentRepository.findByAstrologerAndDate(astrologerId, date)
  }
}