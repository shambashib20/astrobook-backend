import { and, desc, eq, gt, lt, sql } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { appointments, cancellationRequests, walletCredits } from '@/core/database/schema'
import type { NewCancellationRequest, NewWalletCredit } from '@/core/database/schema'

export class WalletRepository {
  constructor(private readonly db: Database) {}

  // ── Wallet Balance ──────────────────────────────────────────────────────────
  // SUM(credit entries) - SUM(debit entries)
  async getBalance(userId: string): Promise<{ balance: string; currency: string }> {
    const [creditRow] = await this.db
      .select({ total: sql<string>`coalesce(sum(${walletCredits.amount}), '0')` })
      .from(walletCredits)
      .where(and(eq(walletCredits.userId, userId), eq(walletCredits.type, 'credit')))

    const [debitRow] = await this.db
      .select({ total: sql<string>`coalesce(sum(${walletCredits.amount}), '0')` })
      .from(walletCredits)
      .where(and(eq(walletCredits.userId, userId), eq(walletCredits.type, 'debit')))

    const balance = (Number(creditRow?.total ?? '0') - Number(debitRow?.total ?? '0')).toFixed(2)
    return { balance, currency: 'INR' }
  }

  // ── Wallet Transactions ─────────────────────────────────────────────────────
  async getTransactions(userId: string) {
    return this.db
      .select()
      .from(walletCredits)
      .where(eq(walletCredits.userId, userId))
      .orderBy(desc(walletCredits.createdAt))
      .limit(50)
  }

  // ── Cancellation Requests ───────────────────────────────────────────────────

  async createCancellationRequest(data: NewCancellationRequest) {
    const [req] = await this.db.insert(cancellationRequests).values(data).returning()
    return req!
  }

  async findPendingByUser(userId: string) {
    // Join appointments so the frontend can call slot APIs (astrologerId, serviceId)
    // and show the scheduled time in the choice sheet.
    const rows = await this.db
      .select({
        id: cancellationRequests.id,
        appointmentId: cancellationRequests.appointmentId,
        userId: cancellationRequests.userId,
        amount: cancellationRequests.amount,
        razorpayPaymentId: cancellationRequests.razorpayPaymentId,
        razorpayOrderId: cancellationRequests.razorpayOrderId,
        status: cancellationRequests.status,
        initiatedBy: cancellationRequests.initiatedBy,
        expiresAt: cancellationRequests.expiresAt,
        createdAt: cancellationRequests.createdAt,
        updatedAt: cancellationRequests.updatedAt,
        apptAstrologerId: appointments.astrologerId,
        apptServiceId: appointments.serviceId,
        apptScheduledAt: appointments.scheduledAt,
      })
      .from(cancellationRequests)
      .leftJoin(appointments, eq(appointments.id, cancellationRequests.appointmentId))
      .where(
        and(
          eq(cancellationRequests.userId, userId),
          eq(cancellationRequests.status, 'pending'),
        ),
      )
      .orderBy(desc(cancellationRequests.createdAt))

    return rows.map((r) => ({
      id: r.id,
      appointmentId: r.appointmentId,
      userId: r.userId,
      amount: r.amount,
      razorpayPaymentId: r.razorpayPaymentId,
      razorpayOrderId: r.razorpayOrderId,
      status: r.status,
      initiatedBy: r.initiatedBy,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      appointment: r.apptScheduledAt
        ? {
            scheduledAt: r.apptScheduledAt,
            astrologerId: r.apptAstrologerId!,
            serviceId: r.apptServiceId!,
          }
        : undefined,
    }))
  }

  async findById(id: string) {
    const [req] = await this.db
      .select()
      .from(cancellationRequests)
      .where(eq(cancellationRequests.id, id))
      .limit(1)
    return req ?? null
  }

  async updateStatus(id: string, status: 'pending' | 'refunded' | 'credited' | 'timing_changed') {
    const [req] = await this.db
      .update(cancellationRequests)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(cancellationRequests.id, id))
      .returning()
    return req ?? null
  }

  // Ek appointment ke liye pending request (user reschedule ke waqt close karne ke liye)
  async findPendingByAppointment(appointmentId: string) {
    const [req] = await this.db
      .select()
      .from(cancellationRequests)
      .where(
        and(
          eq(cancellationRequests.appointmentId, appointmentId),
          eq(cancellationRequests.status, 'pending'),
        ),
      )
      .limit(1)
    return req ?? null
  }

  // Weekly/monthly reschedule limit check — timing_changed requests count since `since`
  async countTimingChangesSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ cnt: sql<string>`count(*)` })
      .from(cancellationRequests)
      .where(
        and(
          eq(cancellationRequests.userId, userId),
          eq(cancellationRequests.status, 'timing_changed'),
          gt(cancellationRequests.updatedAt, since),
        ),
      )
    return Number(row?.cnt ?? '0')
  }

  // Cron sweep: expired + still pending
  async findExpiredPending(now: Date) {
    return this.db
      .select()
      .from(cancellationRequests)
      .where(
        and(
          eq(cancellationRequests.status, 'pending'),
          lt(cancellationRequests.expiresAt, now),
        ),
      )
  }

  // ── Wallet Credits / Debits ─────────────────────────────────────────────────

  async addCredit(data: NewWalletCredit) {
    const [credit] = await this.db.insert(walletCredits).values(data).returning()
    return credit!
  }

  async addDebit(data: NewWalletCredit) {
    const [debit] = await this.db.insert(walletCredits).values(data).returning()
    return debit!
  }
}
