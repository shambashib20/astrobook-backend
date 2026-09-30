import { eq, sql, desc, and, ilike, or, count } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { payments, appointments, consultationServices, users } from '@/core/database/schema'
import type { NewPayment } from '@/core/database/schema'

export class PaymentRepository {
  constructor(private readonly db: Database) {}

  // ── Astrologer Transactions ─────────────────────────────────────────────────
  // Sirf 'success' payments dikhate hain (pending/failed astrologer ke liye
  // "kamaya hua paisa" nahi hai)
  async findByAstrologer(astrologerId: string) {
    return this.db
      .select({
        id: payments.id,
        amount: payments.amount,
        status: payments.status,
        createdAt: payments.createdAt,
        appointmentId: payments.appointmentId,
        serviceTitle: consultationServices.title,
        clientName: users.name,
        scheduledAt: appointments.scheduledAt,
      })
      .from(payments)
      .innerJoin(appointments, eq(payments.appointmentId, appointments.id))
      .innerJoin(consultationServices, eq(appointments.serviceId, consultationServices.id))
      .innerJoin(users, eq(appointments.userId, users.id))
      .where(and(eq(appointments.astrologerId, astrologerId), eq(payments.status, 'success')))
      .orderBy(desc(payments.createdAt))
  }

  async create(data: NewPayment) {
    const [payment] = await this.db.insert(payments).values(data).returning()
    return payment!
  }

  async findById(id: string) {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, id)).limit(1)
    return payment ?? null
  }

  async findByAppointmentId(appointmentId: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.appointmentId, appointmentId))
      .limit(1)
    return payment ?? null
  }

  async findByOrderId(razorpayOrderId: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.razorpayOrderId, razorpayOrderId))
      .limit(1)
    return payment ?? null
  }

  // Cart checkout mein ek hi razorpayOrderId ke saath multiple payment rows
  // ban sakti hain (ek per appointment) — sabko fetch karne ke liye
  async findAllByOrderId(razorpayOrderId: string) {
    return this.db.select().from(payments).where(eq(payments.razorpayOrderId, razorpayOrderId))
  }

  async updateByOrderId(
    razorpayOrderId: string,
    data: Partial<{
      status: 'pending' | 'success' | 'failed' | 'refunded'
      razorpayPaymentId: string
      razorpaySignature: string
      method: string
      capturedAt: Date
      failureCode: string
      failureReason: string
    }>,
  ) {
    const [payment] = await this.db
      .update(payments)
      .set({ ...data, updatedAt: sql`now()` })
      .where(eq(payments.razorpayOrderId, razorpayOrderId))
      .returning()
    return payment ?? null
  }

  // ── Admin: full transaction ledger for reconciliation ───────────────────────
  async listTransactions(opts: {
    page: number
    limit: number
    status?: string
    userId?: string
    astrologerId?: string
    search?: string
  }) {
    const { page, limit, status, userId, astrologerId, search } = opts
    const offset = (page - 1) * limit

    const u1 = users
    // We need two user aliases for payer and astrologer — Drizzle doesn't
    // support SQL-level aliases, so we do two separate sub-selects instead via
    // a raw join with explicit ON clauses through aliased table references.
    // Simpler approach: fetch the joined row and map the two user name columns.

    const conditions = []
    if (status) conditions.push(eq(payments.status, status as any))
    if (userId) conditions.push(eq(payments.userId, userId))
    if (astrologerId) conditions.push(eq(payments.astrologerId, astrologerId))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          id: payments.id,
          appointmentId: payments.appointmentId,
          userId: payments.userId,
          astrologerId: payments.astrologerId,
          razorpayOrderId: payments.razorpayOrderId,
          razorpayPaymentId: payments.razorpayPaymentId,
          amount: payments.amount,
          currency: payments.currency,
          method: payments.method,
          status: payments.status,
          failureCode: payments.failureCode,
          failureReason: payments.failureReason,
          capturedAt: payments.capturedAt,
          createdAt: payments.createdAt,
          updatedAt: payments.updatedAt,
          serviceTitle: consultationServices.title,
          scheduledAt: appointments.scheduledAt,
          userName: u1.name,
          userEmail: u1.email,
        })
        .from(payments)
        .leftJoin(appointments, eq(payments.appointmentId, appointments.id))
        .leftJoin(consultationServices, eq(appointments.serviceId, consultationServices.id))
        .leftJoin(u1, eq(payments.userId, u1.id))
        .where(whereClause)
        .orderBy(desc(payments.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(payments).where(whereClause),
    ])

    return { rows, total: totalRow?.total ?? 0 }
  }

  // Stale-pending-booking cleanup ke liye — agar order create ho chuka tha
  // (payment row exist karta hai) lekin kabhi paid nahi hua, usse 'failed'
  // mark karo taaki records clean rahein. Order kabhi bana hi nahi (user
  // checkout tak pahuncha hi nahi) toh koi row milegi hi nahi — fine, no-op.
  async markFailedByAppointmentId(appointmentId: string) {
    const [payment] = await this.db
      .update(payments)
      .set({ status: 'failed', updatedAt: sql`now()` })
      .where(and(eq(payments.appointmentId, appointmentId), eq(payments.status, 'pending')))
      .returning()
    return payment ?? null
  }

  // ── Cashfree-era methods (commented out during the Razorpay rollback —
  // kept, not deleted, for a quick re-migration) ──
  // async getAstrologerPayoutInfo(astrologerId: string) { ... }
  // async getCustomerDetails(userId: string) { ... }
  // async markRefundPending(appointmentId: string) { ... }
  // async findPendingRefunds() { ... }
  // async recordRefund(paymentId: string, data: {...}) { ... }
}
