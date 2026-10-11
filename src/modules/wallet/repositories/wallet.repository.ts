import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { cancellationRequests, walletCredits } from '@/core/database/schema'
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
    return this.db
      .select()
      .from(cancellationRequests)
      .where(
        and(
          eq(cancellationRequests.userId, userId),
          eq(cancellationRequests.status, 'pending'),
        ),
      )
      .orderBy(desc(cancellationRequests.createdAt))
  }

  async findById(id: string) {
    const [req] = await this.db
      .select()
      .from(cancellationRequests)
      .where(eq(cancellationRequests.id, id))
      .limit(1)
    return req ?? null
  }

  async updateStatus(id: string, status: 'pending' | 'refunded' | 'credited') {
    const [req] = await this.db
      .update(cancellationRequests)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(cancellationRequests.id, id))
      .returning()
    return req ?? null
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

  // ── Wallet Credits ──────────────────────────────────────────────────────────

  async addCredit(data: NewWalletCredit) {
    const [credit] = await this.db.insert(walletCredits).values(data).returning()
    return credit!
  }
}
