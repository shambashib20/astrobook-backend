import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { AppointmentRepository } from '../repositories/appointment.repository'
import type { ConsultationService } from './consultation.service'
import type { AgoraService } from './agora.service'
import type { PushNotificationService } from '@/core/services/push-notification.service'
import type { CreateBookingDto } from '../schemas/consultation.schema'
import type { Appointment } from '@/core/database/schema'

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

    const updated = await this.appointmentRepository.update(appointmentId, { status: 'cancelled' })

    // Jo party cancel nahi kar rahi, usko batao — requester ko khud pata hai
    const otherPartyId =
      requesterId === appointment.userId ? appointment.astrologerId : appointment.userId
    this.pushNotificationService.sendToUser(otherPartyId, {
      title: 'Booking Cancelled',
      body: 'Tumhari ek booking cancel ho gayi hai',
      data: { type: 'booking_cancelled', appointmentId },
    })

    return updated!
  }

  // ── Astrologer Schedule ────────────────────────────────────────────────────

  async getSchedule(astrologerId: string, date: string) {
    return this.appointmentRepository.findByAstrologerAndDate(astrologerId, date)
  }
}
