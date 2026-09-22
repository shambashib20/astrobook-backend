import type { PushNotificationService } from '@/core/services/push-notification.service'
import {
  SESSION_SWEEP_INTERVAL_MS,
  SESSION_SWEEP_JOB,
  recordCronError,
  recordCronRun,
  recordCronSuccess,
} from '@/core/utils/cron-heartbeat'
import { pushLog } from '@/core/utils/log-buffer'
import type { AppointmentRepository } from '@/modules/consultation/repositories/appointment.repository'
import type { FastifyBaseLogger } from 'fastify'

// ─── Session sweep scheduler ─────────────────────────────────────────────────
//
// Kaam wahi hai jo pehle `setInterval(..., 1 min)` karta tha:
//   1. 'ongoing' sessions jinka endsAt nikal gaya → 'completed'
//   2. Jo confirmed appointments 5 min mein shuru honge → dono ko push reminder
//
// Fark sirf "kab chalna hai" mein hai. Pehle har minute DB query hoti thi, is
// wajah se Neon kabhi suspend nahi hota tha. Ab:
//   - Har run ke baad DB se poochte hain ki agla kaam kab due hai
//     (findNextSweepDueAt) aur theek us waqt ka timer lagate hain.
//   - Kuch due nahi → MAX_IDLE_GAP_MS baad ek baar check (safety net).
//   - Koi bhi write request aaye (booking, payment webhook, session start,
//     reschedule...) → wakeSessionSweep() se jaldi recheck. Us waqt DB already
//     jaaga hota hai, isliye ye extra query free hai.
// Beech ke time DB ko koi query nahi jaati, Neon so sakta hai.

const MAX_IDLE_GAP_MS = SESSION_SWEEP_INTERVAL_MS // 60 min
const MIN_DELAY_MS = 5_000 // tight loop se bachao
const DUE_MARGIN_MS = 2_000 // due time pe query ke `<` boundary se thoda aage
const ERROR_RETRY_MS = 60_000 // DB down ho to har minute retry, spam nahi
const WAKE_DEBOUNCE_MS = 5_000 // ek saath kai write requests → ek hi recheck

type Deps = {
  appointmentRepo: AppointmentRepository
  pushNotificationService: PushNotificationService
  log: FastifyBaseLogger
}

let active: SessionSweepScheduler | null = null

/**
 * Kisi write request ke baad bulao — agar koi appointment bana/badla hai to
 * sweep jaldi recheck karega ki agla reminder / session-end kab due hai.
 * Scheduler start nahi hua (tests, scripts) to no-op.
 */
export function wakeSessionSweep(): void {
  active?.wake()
}

export class SessionSweepScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private nextRunAt = 0
  private running = false
  private rerunAfterCurrent = false
  private stopped = false

  constructor(private readonly deps: Deps) {}

  start(initialDelayMs = 10_000): void {
    this.stopped = false
    active = this
    this.scheduleIn(initialDelayMs)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (active === this) active = null
  }

  wake(): void {
    if (this.stopped) return
    if (this.running) {
      // Abhi chal raha hai — khatam hone ke baad ek aur baar
      this.rerunAfterCurrent = true
      return
    }
    // Pehle se jaldi run scheduled hai to use aage mat khiskao
    if (this.timer && this.nextRunAt - Date.now() <= WAKE_DEBOUNCE_MS) return
    this.scheduleIn(WAKE_DEBOUNCE_MS)
  }

  private scheduleIn(delayMs: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    const delay = Math.min(Math.max(delayMs, MIN_DELAY_MS), MAX_IDLE_GAP_MS)
    this.nextRunAt = Date.now() + delay
    this.timer = setTimeout(() => void this.run(), delay)
    this.timer.unref?.()
  }

  private async run(): Promise<void> {
    this.timer = null
    this.running = true
    this.rerunAfterCurrent = false
    recordCronRun(SESSION_SWEEP_JOB)

    const hadError = await this.sweepOnce()
    let nextDelay = MAX_IDLE_GAP_MS

    if (hadError) {
      nextDelay = ERROR_RETRY_MS
    } else {
      recordCronSuccess(SESSION_SWEEP_JOB)
      try {
        const nextDue = await this.deps.appointmentRepo.findNextSweepDueAt()
        if (nextDue) nextDelay = nextDue.getTime() - Date.now() + DUE_MARGIN_MS
      } catch (err) {
        this.logError('Session sweep: next-due lookup failed', err)
        nextDelay = ERROR_RETRY_MS
      }
    }

    this.running = false
    this.scheduleIn(this.rerunAfterCurrent ? WAKE_DEBOUNCE_MS : nextDelay)
  }

  /** @returns true agar koi step fail hua */
  private async sweepOnce(): Promise<boolean> {
    const { appointmentRepo, pushNotificationService, log } = this.deps
    let hadError = false

    try {
      const completed = await appointmentRepo.completeTimedOutSessions()
      if (completed.length > 0) {
        log.info({ count: completed.length }, 'Auto-completed timed-out sessions')
      }
    } catch (err) {
      hadError = true
      this.logError('Session auto-timeout sweep failed', err)
    }

    try {
      const needingReminder = await appointmentRepo.findUpcomingNeedingReminder()
      for (const appointment of needingReminder) {
        const payload = {
          title: 'Session Jaldi Shuru Hoga',
          body: 'Tumhara session 5 minute mein shuru hone wala hai',
          data: { type: 'session_reminder', appointmentId: appointment.id },
        }
        await pushNotificationService.sendToUser(appointment.userId, payload)
        await pushNotificationService.sendToUser(appointment.astrologerId, payload)
        await appointmentRepo.markReminderSent(appointment.id)
      }
      if (needingReminder.length > 0) {
        log.info({ count: needingReminder.length }, 'Sent session-starting-soon reminders')
      }
    } catch (err) {
      hadError = true
      this.logError('Session reminder sweep failed', err)
    }

    return hadError
  }

  private logError(message: string, err: unknown): void {
    this.deps.log.error(err, message)
    recordCronError(SESSION_SWEEP_JOB, err)
    pushLog('cron', 'error', message, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}