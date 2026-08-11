import { buildApp } from './app'
import { env } from './config/env'
import { closeDb, getDb } from './core/database/client'
import {
  SESSION_SWEEP_INTERVAL_MS,
  SESSION_SWEEP_JOB,
  recordCronError,
  recordCronRun,
  recordCronSuccess,
} from './core/utils/cron-heartbeat'
import { pushLog } from './core/utils/log-buffer'
import { AppointmentRepository } from './modules/consultation/repositories/appointment.repository'
import { PushNotificationService } from './core/services/push-notification.service'

async function start() {
  const app = await buildApp()

  // ── Auto-timeout + reminder background sweep ──────────────────────────────
  // 1. 'ongoing' sessions jinka scheduled time nikal chuka hai, unhe safety
  //    net ke taur pe har minute check karke 'completed' kar do — is se
  //    independent hai ki koi request aayi ya nahi
  // 2. "Session starting soon" push reminder — jo appointments agle 10 min
  //    mein shuru hone wale hain, dono parties ko ek baar notify karo
  const appointmentRepo = new AppointmentRepository(getDb())
  const pushNotificationService = new PushNotificationService(getDb())
  const timeoutSweepInterval = setInterval(async () => {
    recordCronRun(SESSION_SWEEP_JOB)
    let hadError = false

    try {
      const completed = await appointmentRepo.completeTimedOutSessions()
      if (completed.length > 0) {
        app.log.info({ count: completed.length }, 'Auto-completed timed-out sessions')
      }
    } catch (err) {
      hadError = true
      app.log.error(err, 'Session auto-timeout sweep failed')
      recordCronError(SESSION_SWEEP_JOB, err)
      pushLog('cron', 'error', 'Session auto-timeout sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    try {
      const needingReminder = await appointmentRepo.findUpcomingNeedingReminder()
      for (const appointment of needingReminder) {
        await pushNotificationService.sendToUser(appointment.userId, {
          title: 'Session Jaldi Shuru Hoga',
          body: 'Tumhara session 10 minute mein shuru hone wala hai',
          data: { type: 'session_reminder', appointmentId: appointment.id },
        })
        await pushNotificationService.sendToUser(appointment.astrologerId, {
          title: 'Session Jaldi Shuru Hoga',
          body: 'Tumhara session 10 minute mein shuru hone wala hai',
          data: { type: 'session_reminder', appointmentId: appointment.id },
        })
        await appointmentRepo.markReminderSent(appointment.id)
      }
      if (needingReminder.length > 0) {
        app.log.info({ count: needingReminder.length }, 'Sent session-starting-soon reminders')
      }
    } catch (err) {
      hadError = true
      app.log.error(err, 'Session reminder sweep failed')
      recordCronError(SESSION_SWEEP_JOB, err)
      pushLog('cron', 'error', 'Session reminder sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    if (!hadError) recordCronSuccess(SESSION_SWEEP_JOB)
  }, SESSION_SWEEP_INTERVAL_MS)

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`)
    clearInterval(timeoutSweepInterval)

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
