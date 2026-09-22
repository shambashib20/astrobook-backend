import { eq, sql, desc, and } from 'drizzle-orm'
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
      status: 'pending' | 'success' | 'failed'
      razorpayPaymentId: string
      razorpaySignature: string
    }>,
  ) {
    const [payment] = await this.db
      .update(payments)
      .set({ ...data, updatedAt: sql`now()` })
      .where(eq(payments.razorpayOrderId, razorpayOrderId))
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
