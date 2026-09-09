import { eq, sql, desc, and } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import {
  payments,
  appointments,
  consultationServices,
  users,
  astrologerProfiles,
} from '@/core/database/schema'
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

  // ── Cashfree split inputs ────────────────────────────────────────────────
  // commissionPercentage is read LIVE (default 30 if never set) — an admin
  // changing it mid-day must apply to the very next order created, not just
  // ones after a cache refresh, so this is a plain query, never cached.
  async getAstrologerPayoutInfo(astrologerId: string) {
    const [row] = await this.db
      .select({
        cashfreeVendorId: astrologerProfiles.cashfreeVendorId,
        commissionPercentage: sql<number>`coalesce((${users.meta}->>'commissionPercentage')::float8, 30)`,
      })
      .from(users)
      .leftJoin(astrologerProfiles, eq(astrologerProfiles.userId, users.id))
      .where(eq(users.id, astrologerId))
      .limit(1)
    return row ?? null
  }

  // Cashfree's order create needs the paying customer's contact details.
  async getCustomerDetails(userId: string) {
    const [row] = await this.db
      .select({ name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return row ?? null
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

  async findByOrderId(cashfreeOrderId: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.cashfreeOrderId, cashfreeOrderId))
      .limit(1)
    return payment ?? null
  }

  // Cart checkout mein ek hi cashfreeOrderId ke saath multiple payment rows
  // ban sakti hain (ek per appointment) — sabko fetch karne ke liye
  async findAllByOrderId(cashfreeOrderId: string) {
    return this.db.select().from(payments).where(eq(payments.cashfreeOrderId, cashfreeOrderId))
  }

  async updateByOrderId(
    cashfreeOrderId: string,
    data: Partial<{
      status: 'pending' | 'success' | 'failed'
      cashfreePaymentId: string
    }>,
  ) {
    const [payment] = await this.db
      .update(payments)
      .set({ ...data, updatedAt: sql`now()` })
      .where(eq(payments.cashfreeOrderId, cashfreeOrderId))
      .returning()
    return payment ?? null
  }

  // Cancel flow flags a paid appointment's payment as refund-eligible;
  // admin's refund endpoint then reads this queue and acts on it.
  async markRefundPending(appointmentId: string) {
    await this.db
      .update(payments)
      .set({ refundStatus: 'pending', updatedAt: sql`now()` })
      .where(and(eq(payments.appointmentId, appointmentId), eq(payments.status, 'success')))
  }

  async findPendingRefunds() {
    return this.db
      .select()
      .from(payments)
      .where(and(eq(payments.status, 'success'), eq(payments.refundStatus, 'pending')))
      .orderBy(desc(payments.createdAt))
  }

  async recordRefund(
    paymentId: string,
    data: {
      refundStatus: 'success' | 'failed'
      refundedAmount: string
      cashfreeRefundId: string
    },
  ) {
    const [payment] = await this.db
      .update(payments)
      .set({ ...data, refundedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(payments.id, paymentId))
      .returning()
    return payment ?? null
  }
}
