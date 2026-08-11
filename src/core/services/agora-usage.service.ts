import { env } from '@/config/env'

/**
 * Agora "Usage Inquiry" RESTful API — reports RTC seconds consumed for the
 * project, per day, for a date range. Auth is separate from the App
 * ID/Certificate pair used for RTC token signing: it's HTTP Basic Auth with
 * a Customer ID/Secret generated in Agora Console → RESTful API.
 *
 * The usage endpoint (`/dev/v3/usage`) takes a `project_id`, which is NOT
 * the same value as AGORA_APP_ID — it's the internal project id Agora
 * assigns, only obtainable by calling the "Get all projects" API and
 * matching on `vendor_key` (== the App ID). So this module resolves
 * project_id once (per process) via that lookup, then reuses it.
 */

const AGORA_PROJECTS_URL = 'https://api.agora.io/dev/v1/projects'
const AGORA_USAGE_URL = 'https://api.agora.io/dev/v3/usage'

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

function authHeader(): string {
  return `Basic ${Buffer.from(`${env.AGORA_CUSTOMER_ID}:${env.AGORA_CUSTOMER_SECRET}`).toString('base64')}`
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

// project_id rarely/never changes for a given App ID — cache it for the
// life of the process instead of hitting /projects on every health check.
let cachedProjectId: string | null = null

async function resolveProjectId(): Promise<string> {
  if (cachedProjectId) return cachedProjectId

  const response = await fetch(AGORA_PROJECTS_URL, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`Agora projects API returned HTTP ${response.status}`)
  }

  const body = (await response.json().catch(() => null)) as {
    projects?: Array<{ id?: string; vendor_key?: string }>
  } | null

  const match = body?.projects?.find((p) => p.vendor_key === env.AGORA_APP_ID)
  if (!match?.id) {
    throw new Error(
      `No Agora project found with vendor_key matching AGORA_APP_ID (${env.AGORA_APP_ID})`,
    )
  }

  cachedProjectId = match.id
  return cachedProjectId
}

export async function getAgoraUsageThisMonth(): Promise<AgoraUsageResult> {
  if (!env.AGORA_CUSTOMER_ID || !env.AGORA_CUSTOMER_SECRET) {
    return {
      configured: false,
      reason: 'AGORA_CUSTOMER_ID / AGORA_CUSTOMER_SECRET not set in .env — generate them in Agora Console → RESTful API',
    }
  }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  let projectId: string
  try {
    projectId = await resolveProjectId()
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const url = `${AGORA_USAGE_URL}?project_id=${projectId}&from_date=${toDateStr(monthStart)}&to_date=${toDateStr(now)}&business=default`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: authHeader(), Accept: 'application/json' },
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

  type UsageEntry = {
    usage?: {
      durationAudioAll?: number
      durationVideo1080P?: number
      durationVideo2K?: number
      durationVideo4K?: number
      durationVideoHd?: number
      durationVideoHdp?: number
    }
  }
  const usages = (body as { usages?: UsageEntry[] })?.usages ?? []
  const totalSeconds = usages.reduce((sum, entry) => {
    const u = entry.usage ?? {}
    return (
      sum +
      (Number(u.durationAudioAll) || 0) +
      (Number(u.durationVideo1080P) || 0) +
      (Number(u.durationVideo2K) || 0) +
      (Number(u.durationVideo4K) || 0) +
      (Number(u.durationVideoHd) || 0) +
      (Number(u.durationVideoHdp) || 0)
    )
  }, 0)
  const totalMinutes = Math.round((totalSeconds / 60) * 100) / 100

  return {
    configured: true,
    ok: true,
    month,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    raw: body,
  }
}
