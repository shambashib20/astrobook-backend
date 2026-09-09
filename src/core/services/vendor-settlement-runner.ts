import { desc, eq, isNotNull } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { astrologerProfiles, vendorSettlements } from '@/core/database/schema'
import { settleVendorInterval } from './cashfree-vendor.service'

// Called from server.ts's daily cron tick, but only actually does anything
// on the 8th of the month — see that file for why this is driven by our
// own cron rather than Cashfree's built-in scheduled-cycle feature (we
// don't control that cycle's exact day-of-month).
//
// Idempotent per astrologer per month: skips anyone already settled this
// calendar month, so a tick that somehow fires twice on the 8th (e.g.
// around a server restart) doesn't double-settle.
export async function runMonthlySettlement(
  db: Database,
): Promise<{ settled: number; failed: number }> {
  const vendors = await db
    .select({ astrologerId: astrologerProfiles.userId, cashfreeVendorId: astrologerProfiles.cashfreeVendorId })
    .from(astrologerProfiles)
    .where(isNotNull(astrologerProfiles.cashfreeVendorId))

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  let settled = 0
  let failed = 0

  for (const vendor of vendors) {
    if (!vendor.cashfreeVendorId) continue

    const [lastRun] = await db
      .select({ periodEnd: vendorSettlements.periodEnd })
      .from(vendorSettlements)
      .where(eq(vendorSettlements.astrologerId, vendor.astrologerId))
      .orderBy(desc(vendorSettlements.periodEnd))
      .limit(1)

    if (lastRun && lastRun.periodEnd >= monthStart) continue // already settled this month

    const periodStart = lastRun?.periodEnd ?? monthStart
    try {
      const response = await settleVendorInterval(vendor.cashfreeVendorId, periodStart, now)
      await db.insert(vendorSettlements).values({
        astrologerId: vendor.astrologerId,
        cashfreeVendorId: vendor.cashfreeVendorId,
        periodStart,
        periodEnd: now,
        status: 'success',
        cashfreeResponse: response,
      })
      settled++
    } catch (err) {
      await db.insert(vendorSettlements).values({
        astrologerId: vendor.astrologerId,
        cashfreeVendorId: vendor.cashfreeVendorId,
        periodStart,
        periodEnd: now,
        status: 'failed',
        cashfreeResponse: { error: err instanceof Error ? err.message : String(err) },
      })
      failed++
    }
  }

  return { settled, failed }
}
