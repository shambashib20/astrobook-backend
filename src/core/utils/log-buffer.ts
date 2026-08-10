/**
 * Small in-memory ring buffer of recent log lines, keyed by service name.
 * Used so the admin health endpoint can attach "why is this down" context
 * without reaching into an external log store — just the last few lines
 * for whichever service (db/cron) is currently unhealthy.
 */

type LogLevel = 'info' | 'warn' | 'error'

export type LogEntry = {
  timestamp: string
  level: LogLevel
  message: string
  meta?: Record<string, unknown>
}

const MAX_ENTRIES_PER_SERVICE = 20

const buffers = new Map<string, LogEntry[]>()

export function pushLog(
  service: string,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const entry: LogEntry = { timestamp: new Date().toISOString(), level, message, meta }
  const entries = buffers.get(service) ?? []
  entries.push(entry)
  if (entries.length > MAX_ENTRIES_PER_SERVICE) entries.shift()
  buffers.set(service, entries)
}

export function getRecentLogs(service: string, limit = 10): LogEntry[] {
  const entries = buffers.get(service) ?? []
  return entries.slice(-limit)
}
