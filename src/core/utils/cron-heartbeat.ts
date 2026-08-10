/**
 * Tracks liveness of the background interval jobs (session auto-timeout
 * sweep, DB keep-alive ping, etc.) so the admin health endpoint can report
 * whether they're actually ticking, not just that the process is up.
 */

// Known job names + their expected tick interval — shared between the code
// that records heartbeats (server.ts, database client) and the code that
// reads status back out (admin health endpoint), so they can't drift apart.
export const SESSION_SWEEP_JOB = 'session-sweep'
export const SESSION_SWEEP_INTERVAL_MS = 60 * 1000

export const DB_KEEPALIVE_JOB = 'db-keepalive'
export const DB_KEEPALIVE_INTERVAL_MS = 4 * 60_000

type JobState = {
  lastRunAt: Date | null
  lastSuccessAt: Date | null
  lastError: string | null
}

const jobs = new Map<string, JobState>()
const processStartedAt = Date.now()

function getOrInit(jobName: string): JobState {
  let state = jobs.get(jobName)
  if (!state) {
    state = { lastRunAt: null, lastSuccessAt: null, lastError: null }
    jobs.set(jobName, state)
  }
  return state
}

export function recordCronRun(jobName: string): void {
  getOrInit(jobName).lastRunAt = new Date()
}

export function recordCronSuccess(jobName: string): void {
  const state = getOrInit(jobName)
  state.lastSuccessAt = new Date()
  state.lastError = null
}

export function recordCronError(jobName: string, err: unknown): void {
  getOrInit(jobName).lastError = err instanceof Error ? err.message : String(err)
}

export type CronJobStatus = {
  name: string
  healthy: boolean
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
}

// A job counts unhealthy if it has never run, hasn't run within 2x its
// expected interval (missed ticks), or its last run errored.
export function getCronStatus(jobName: string, expectedIntervalMs: number): CronJobStatus {
  const state = jobs.get(jobName)
  if (!state?.lastRunAt) {
    // Fresh restart — the job's first tick hasn't come due yet (e.g.
    // db-keepalive only fires every 4 min). Not an actual failure, so give
    // it one full interval + buffer before calling it unhealthy.
    const withinStartupGrace = Date.now() - processStartedAt <= expectedIntervalMs * 1.5
    return {
      name: jobName,
      healthy: withinStartupGrace && !state?.lastError,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: state?.lastError ?? (withinStartupGrace ? null : 'never run'),
    }
  }

  const ageMs = Date.now() - state.lastRunAt.getTime()
  const healthy = ageMs <= expectedIntervalMs * 2 && !state.lastError

  return {
    name: jobName,
    healthy,
    lastRunAt: state.lastRunAt.toISOString(),
    lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
    lastError: state.lastError,
  }
}
