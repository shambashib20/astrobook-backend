import { buildApp } from './app'
import { env } from './config/env'
import { closeDb, getDb } from './core/database/client'
import {
  NOTIFICATION_CLEANUP_INTERVAL_MS,
  NOTIFICATION_CLEANUP_JOB,
  SETTLEMENT_INTERVAL_MS,
  SETTLEMENT_JOB,
  recordCronError,
  recordCronRun,
  recordCronSuccess,
} from './core/utils/cron-heartbeat'
import { pushLog } from './core/utils/log-buffer'
import { AppointmentRepository } from './modules/consultation/repositories/appointment.repository'
import { PushNotificationService } from './core/services/push-notification.service'
import { NotificationsRepository } from './modules/notifications/repositories/notifications.repository'
import { NotificationsService } from './modules/notifications/services/notifications.service'
import { runMonthlySettlement } from './core/services/vendor-settlement-runner'
import { SessionSweepScheduler } from './core/services/session-sweep-scheduler'

async function start() {
  const app = await buildApp()

  // ── Auto-timeout + reminder background sweep ──────────────────────────────
  // 1. 'ongoing' sessions jinka endsAt nikal chuka hai → 'completed'
  // 2. Jo appointments 5 min mein shuru honge → dono parties ko push reminder
  // Fixed "har minute" nahi — sirf jab kaam due ho ya koi write request aaye
  // (details: session-sweep-scheduler.ts). Isse Neon beech mein so pata hai.
  const appointmentRepo = new AppointmentRepository(getDb())
  const pushNotificationService = new PushNotificationService(getDb())
  const sessionSweep = new SessionSweepScheduler({
    appointmentRepo,
    pushNotificationService,
    log: app.log,
  })
  sessionSweep.start()

  // ── Notification cleanup sweep ─────────────────────────────────────────────
  // 7-din se purani notifications delete — sabhi users ki, ek saath. Table
  // ko unbounded grow nahi hone dena, aur purani notifications user ke liye
  // anyway relevant nahi rehtin.
  const notificationsService = new NotificationsService(
    new NotificationsRepository(getDb()),
    pushNotificationService,
  )
  const notificationCleanupInterval = setInterval(async () => {
    recordCronRun(NOTIFICATION_CLEANUP_JOB)
    try {
      const deletedCount = await notificationsService.cleanupOld()
      if (deletedCount > 0) {
        app.log.info({ count: deletedCount }, 'Cleaned up old notifications (7+ days)')
      }
      recordCronSuccess(NOTIFICATION_CLEANUP_JOB)
    } catch (err) {
      app.log.error(err, 'Notification cleanup sweep failed')
      recordCronError(NOTIFICATION_CLEANUP_JOB, err)
      pushLog('cron', 'error', 'Notification cleanup sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, NOTIFICATION_CLEANUP_INTERVAL_MS)

  // ── Astrologer payout settlement — the 8th of every month ──────────────────
  // Ticks daily (like the sweeps above) but only actually calls Cashfree
  // when today is the 8th — see runMonthlySettlement for the per-astrologer
  // idempotency guard (skips anyone already settled this calendar month, so
  // a duplicate same-day tick around a restart doesn't double-settle). This
  // deliberately drives settlement ourselves rather than relying on
  // Cashfree's own scheduled-cycle feature, which doesn't give exact
  // day-of-month control.
  const settlementInterval = setInterval(async () => {
    recordCronRun(SETTLEMENT_JOB)
    if (new Date().getUTCDate() !== 8) {
      recordCronSuccess(SETTLEMENT_JOB)
      return
    }
    try {
      const { settled, failed } = await runMonthlySettlement(getDb())
      app.log.info({ settled, failed }, 'Monthly vendor settlement run complete')
      recordCronSuccess(SETTLEMENT_JOB)
    } catch (err) {
      app.log.error(err, 'Monthly vendor settlement run failed')
      recordCronError(SETTLEMENT_JOB, err)
      pushLog('cron', 'error', 'Monthly vendor settlement run failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, SETTLEMENT_INTERVAL_MS)

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`)
    sessionSweep.stop()
    clearInterval(notificationCleanupInterval)
    clearInterval(settlementInterval)

    try {
      await app.close()
      await closeDb()
      app.log.info('Server closed. DB connections drained.')
      process.exit(0)
    } catch (err) {
      app.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Uncaught exception — shutting down')
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ reason }, 'Unhandled rejection — shutting down')
    process.exit(1)
  })

  // Start server
  try {
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info(`🚀 Server running on http://${env.HOST}:${env.PORT}`)
    app.log.info(`📚 Swagger docs at http://localhost:${env.PORT}/docs`)
  } catch (err) {
    app.log.error(err, 'Failed to start server')
    process.exit(1)
  }
}

start()