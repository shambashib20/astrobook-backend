import { env } from '@/config/env'

/**
 * Agora "Usage Inquiry" RESTful API — reports RTC minutes consumed for the
 * app, per day, for a given month. Auth is separate from the App
 * ID/Certificate pair used for RTC token signing: it's HTTP Basic Auth with
 * a Customer ID/Secret generated in Agora Console → RESTful API.
 *
 * NOTE: the response shape below is Agora's documented usage-endpoint shape
 * at time of writing, not something we've verified against a live call (no
 * AGORA_CUSTOMER_ID/SECRET configured yet). `raw` is always included in the
 * result so a schema drift is visible immediately instead of silently
 * producing a wrong total once real credentials are added.
 */

const AGORA_USAGE_BASE_URL = 'https://api.agora.io/dev/v1/usage'
const RTC_USAGE_TYPE = 1 // audio+video minutes; Agora also has other `type` codes for recording etc.

export type AgoraUsageResult =
  | { configured: false; reason: string }
  | {
      configured: true
      ok: true
      month: string
      totalMinutes: number
      totalHours: number
      raw: unknown
    }
  | {
      configured: true
      ok: false
      error: string
      raw?: unknown
    }

function currentYyyyMm(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function getAgoraUsageThisMonth(): Promise<AgoraUsageResult> {
  if (!env.AGORA_CUSTOMER_ID || !env.AGORA_CUSTOMER_SECRET) {
    return {
      configured: false,
      reason: 'AGORA_CUSTOMER_ID / AGORA_CUSTOMER_SECRET not set in .env — generate them in Agora Console → RESTful API',
    }
  }

  const month = currentYyyyMm()
  const url = `${AGORA_USAGE_BASE_URL}/${env.AGORA_APP_ID}?month=${month}&type=${RTC_USAGE_TYPE}`
  const authHeader = `Basic ${Buffer.from(`${env.AGORA_CUSTOMER_ID}:${env.AGORA_CUSTOMER_SECRET}`).toString('base64')}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    return {
      configured: true,
      ok: false,
      error: `Agora usage API returned HTTP ${response.status}`,
      raw: body,
    }
  }

  // Best-effort extraction — see module docstring on why `raw` always ships too.
  const dailyEntries = (body as { data?: { data?: Array<{ usage?: number }> } })?.data?.data ?? []
  const totalMinutes = dailyEntries.reduce((sum, entry) => sum + (Number(entry?.usage) || 0), 0)

  return {
    configured: true,
    ok: true,
    month,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    raw: body,
  }
}
