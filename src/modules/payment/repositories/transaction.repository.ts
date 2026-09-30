import { eq, desc, and, asc } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { paymentTransactions, users, consultationServices, appointments } from '@/core/database/schema'
import type { NewPaymentTransaction } from '@/core/database/schema'

export class TransactionRepository {
  constructor(private readonly db: Database) {}

  // Append-only — never call update/delete on this table
  async log(data: NewPaymentTransaction) {
    const [row] = await this.db.insert(paymentTransactions).values(data).returning()
    return row!
  }

  // All events for a single Razorpay order — used for dispute resolution
  async findByOrderId(razorpayOrderId: string) {
    return this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.razorpayOrderId, razorpayOrderId))
      .orderBy(asc(paymentTransactions.createdAt))
  }

  // All events for a single appointment
  async findByAppointmentId(appointmentId: string) {
    return this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.appointmentId, appointmentId))
      .orderBy(asc(paymentTransactions.createdAt))
  }

  // ── Admin: paginated event ledger ──────────────────────────────────────────
  async listEvents(opts: {
    page: number
    limit: number
    event?: string
    userId?: string
    astrologerId?: string
    razorpayOrderId?: string
    appointmentId?: string
  }) {
    const { page, limit, event, userId, astrologerId, razorpayOrderId, appointmentId } = opts
    const offset = (page - 1) * limit

    const conditions = []
    if (event) conditions.push(eq(paymentTransactions.event, event as any))
    if (userId) conditions.push(eq(paymentTransactions.userId, userId))
    if (astrologerId) conditions.push(eq(paymentTransactions.astrologerId, astrologerId))
    if (razorpayOrderId) conditions.push(eq(paymentTransactions.razorpayOrderId, razorpayOrderId))
    if (appointmentId) conditions.push(eq(paymentTransactions.appointmentId, appointmentId))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          id: paymentTransactions.id,
          paymentId: paymentTransactions.paymentId,
          appointmentId: paymentTransactions.appointmentId,
          userId: paymentTransactions.userId,
          astrologerId: paymentTransactions.astrologerId,
          razorpayOrderId: paymentTransactions.razorpayOrderId,
          razorpayPaymentId: paymentTransactions.razorpayPaymentId,
          event: paymentTransactions.event,
          amount: paymentTransactions.amount,
          currency: paymentTransactions.currency,
          method: paymentTransactions.method,
          failureCode: paymentTransactions.failureCode,
          failureReason: paymentTransactions.failureReason,
          razorpayFee: paymentTransactions.razorpayFee,
          razorpayTax: paymentTransactions.razorpayTax,
          capturedAt: paymentTransactions.capturedAt,
          createdAt: paymentTransactions.createdAt,
          // Joined fields for readability
          userName: users.name,
          userEmail: users.email,
          serviceTitle: consultationServices.title,
          scheduledAt: appointments.scheduledAt,
        })
        .from(paymentTransactions)
        .leftJoin(users, eq(paymentTransactions.userId, users.id))
        .leftJoin(appointments, eq(paymentTransactions.appointmentId, appointments.id))
        .leftJoin(consultationServices, eq(appointments.serviceId, consultationServices.id))
        .where(whereClause)
        .orderBy(desc(paymentTransactions.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: paymentTransactions.id })
        .from(paymentTransactions)
        .where(whereClause),
    ])

    return { rows, total: countRows.length }
  }
}
