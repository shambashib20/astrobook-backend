import { eq, and, gte, lte, or, sql, inArray, lt, gt, desc } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '@/core/database/client'
import { appointments, consultationServices, users } from '@/core/database/schema'
import type { NewAppointment } from '@/core/database/schema'

const clientUsers = alias(users, 'client_users')

export class AppointmentRepository {
  constructor(private readonly db: Database) {}

  async create(data: NewAppointment) {
    const [appointment] = await this.db.insert(appointments).values(data).returning()
    return appointment!
  }

  async findById(id: string) {
    const [appointment] = await this.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1)
    return appointment ?? null
  }

  // Conflict check — confirmed + ongoing appointments in a time range
  async findConfirmedByAstrologerInRange(astrologerId: string, rangeStart: Date, rangeEnd: Date) {
    return this.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.astrologerId, astrologerId),
          inArray(appointments.status, ['pending', 'confirmed', 'ongoing']),
          lt(appointments.scheduledAt, rangeEnd), // ← rangeEnd
          gt(appointments.endsAt, rangeStart), // ← rangeStart
        ),
      )
  }
  // Full detail query — with service + astrologer info
  private baseDetailQuery(db: Database) {
    return db
      .select({
        id: appointments.id,
        scheduledAt: appointments.scheduledAt,
        endsAt: appointments.endsAt,
        durationMinutes: appointments.durationMinutes,
        // Booking waqt ka price snapshot — astrologer baad mein variant price
        // change kare toh bhi purani booking ka amount yehi rahega. Purani
        // (variant-system se pehle ki) appointments ke liye null ho sakta
        // hai — us case mein service.price pe fallback hota hai (below).
        price: appointments.price,
        status: appointments.status,
        bundleStatus: appointments.bundleStatus,
        parentId: appointments.parentId,
        agoraChannel: appointments.agoraChannel,
        agoraToken: appointments.agoraToken,
        // Astrologer session mein kab live hua — frontend isse decide karta
        // hai ki user ka "Join" button enable karna hai ya "astrologer ka
        // wait karo" dikhana hai
        astrologerJoinedAt: appointments.astrologerJoinedAt,
        notes: appointments.notes,
        createdAt: appointments.createdAt,
        service: {
          id: consultationServices.id,
          isBasic: consultationServices.isBasic,
          title: consultationServices.title,
          coverImage: consultationServices.coverImage,
          durationMinutes: consultationServices.durationMinutes,
          price: consultationServices.price,
        },
        astrologerName: users.name,
        // Astrologer-side session list ke liye client ka naam bhi chahiye
        // (pehle sirf astrologerName tha — astrologer khud ka naam dekhta,
        // useless tha unke liye)
        userName: clientUsers.name,
        astrologerId: appointments.astrologerId,
        userId: appointments.userId,
      })
      .from(appointments)
      .innerJoin(consultationServices, eq(appointments.serviceId, consultationServices.id))
      .innerJoin(users, eq(appointments.astrologerId, users.id))
      .innerJoin(clientUsers, eq(appointments.userId, clientUsers.id))
  }

  // Grouped: upcoming / ongoing / completed / cancelled
  async findMineGrouped(userId: string) {
    const rows = await this.baseDetailQuery(this.db)
      .where(or(eq(appointments.userId, userId), eq(appointments.astrologerId, userId)))
      .orderBy(sql`${appointments.scheduledAt} ASC`)

    return {
      upcoming: rows.filter((r) => r.status === 'confirmed' || r.status === 'pending'),
      ongoing: rows.filter((r) => r.status === 'ongoing'),
      completed: rows.filter((r) => r.status === 'completed'),
      cancelled: rows.filter((r) => r.status === 'cancelled'),
    }
  }

  // Single appointment with full detail
  async findByIdWithDetails(id: string) {
    const [row] = await this.baseDetailQuery(this.db).where(eq(appointments.id, id)).limit(1)
    return row ?? null
  }

  // Child sessions of a parent appointment
  async findChildren(parentId: string) {
    return this.baseDetailQuery(this.db)
      .where(eq(appointments.parentId, parentId))
      .orderBy(sql`${appointments.scheduledAt} ASC`)
  }

  // Astrologer schedule — all confirmed/ongoing for a specific date
  async findByAstrologerAndDate(astrologerId: string, date: string) {
    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(`${date}T23:59:59.999Z`)
    return this.baseDetailQuery(this.db)
      .where(
        and(
          eq(appointments.astrologerId, astrologerId),
          inArray(appointments.status, ['confirmed', 'ongoing']),
          gte(appointments.scheduledAt, dayStart),
          lte(appointments.scheduledAt, dayEnd),
        ),
      )
      .orderBy(sql`${appointments.scheduledAt} ASC`)
  }

  // ── Auto-timeout ─────────────────────────────────────────────────────────
  // 'ongoing' sessions jinka scheduled time nikal chuka hai — end call kisi
  // ne na dabaya ho tab bhi yeh safety net unhe 'completed' kar deta hai
  async completeTimedOutSessions() {
    return this.db
      .update(appointments)
      .set({ status: 'completed', updatedAt: sql`now()` })
      .where(and(eq(appointments.status, 'ongoing'), lt(appointments.endsAt, sql`now()`)))
      .returning({ id: appointments.id })
  }

  // "Session starting soon" push reminder ke liye — jo confirmed appointments
  // agle 10 min mein shuru honge aur jinhe abhi tak reminder nahi bheja gaya
  async findUpcomingNeedingReminder() {
    return this.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.status, 'confirmed'),
          sql`${appointments.reminderSentAt} IS NULL`,
          gt(appointments.scheduledAt, sql`now()`),
          lt(appointments.scheduledAt, sql`now() + interval '10 minutes'`),
        ),
      )
  }

  async markReminderSent(id: string) {
    await this.db
      .update(appointments)
      .set({ reminderSentAt: sql`now()` })
      .where(eq(appointments.id, id))
  }

  async update(
    id: string,
    data: Partial<{
      status: 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled'
      bundleStatus: 'in_progress' | 'paused' | 'completed'
      agoraChannel: string
      agoraToken: string
      astrologerJoinedAt: Date
    }>,
  ) {
    const [appointment] = await this.db
      .update(appointments)
      .set({ ...data, updatedAt: sql`now()` })
      .where(eq(appointments.id, id))
      .returning()
    return appointment ?? null
  }
}
