import { buildApp } from './app'
import { env } from './config/env'
import { closeDb, getDb } from './core/database/client'
import {
  NOTIFICATION_CLEANUP_INTERVAL_MS,
  NOTIFICATION_CLEANUP_JOB,
  STALE_PENDING_CLEANUP_INTERVAL_MS,
  STALE_PENDING_CLEANUP_JOB,
  MISSED_SESSION_SWEEP_INTERVAL_MS,
  MISSED_SESSION_JOB,
  recordCronError,
  recordCronRun,
  recordCronSuccess,
} from './core/utils/cron-heartbeat'
import { pushLog } from './core/utils/log-buffer'
import { AppointmentRepository } from './modules/consultation/repositories/appointment.repository'
import { ServiceRepository } from './modules/consultation/repositories/service.repository'
import { AvailabilityRepository } from './modules/consultation/repositories/availability.repository'
import { PaymentRepository } from './modules/payment/repositories/payment.repositary'
import { PaymentService } from './modules/payment/service/payment.service'
import { ConsultationService } from './modules/consultation/services/consultation.service'
import { BookingService } from './modules/consultation/services/booking.service'
import { AgoraService } from './modules/consultation/services/agora.service'
import { PushNotificationService } from './core/services/push-notification.service'
import { NotificationsRepository } from './modules/notifications/repositories/notifications.repository'
import { NotificationsService } from './modules/notifications/services/notifications.service'
import { SessionSweepScheduler } from './core/services/session-sweep-scheduler'
// Cashfree Easy Split monthly vendor settlement cron — commented out during
// the Razorpay rollback (kept, not deleted, for a quick re-migration). See
// also SETTLEMENT_INTERVAL_MS/SETTLEMENT_JOB in cron-heartbeat.ts.
// import { runMonthlySettlement } from './core/services/vendor-settlement-runner'

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

  // ── Stale pending booking cleanup ──────────────────────────────────────────
  // Payment kabhi shuru hi nahi hui ya beech mein chhod di gayi — bahut der
  // tak 'pending' reh gayi booking us slot ko hamesha ke liye lock kar deti
  // thi (koi cleanup nahi tha pehle). Har 5 min check, 20 min se purani
  // pending bookings cancel ho jaati hain, slot release hota hai.
  const availabilityRepo = new AvailabilityRepository(getDb())
  const serviceRepo = new ServiceRepository(getDb())
  const paymentRepo = new PaymentRepository(getDb())
  const consultationServiceForCleanup = new ConsultationService(
    serviceRepo,
    availabilityRepo,
    appointmentRepo,
  )
  const bookingServiceForCleanup = new BookingService(
    appointmentRepo,
    consultationServiceForCleanup,
    new AgoraService(),
    pushNotificationService,
    paymentRepo,
  )
  const stalePendingCleanupInterval = setInterval(async () => {
    recordCronRun(STALE_PENDING_CLEANUP_JOB)
    try {
      const count = await bookingServiceForCleanup.cancelStalePendingBookings()
      if (count > 0) {
        app.log.info({ count }, 'Cancelled stale pending bookings')
      }
      recordCronSuccess(STALE_PENDING_CLEANUP_JOB)
    } catch (err) {
      app.log.error(err, 'Stale pending booking cleanup failed')
      recordCronError(STALE_PENDING_CLEANUP_JOB, err)
      pushLog('cron', 'error', 'Stale pending booking cleanup failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, STALE_PENDING_CLEANUP_INTERVAL_MS)

  // ── Missed session refund ──────────────────────────────────────────────────
  // Booking 'confirmed' thi (payment ho chuka), lekin astrologer scheduled
  // window mein kabhi join hi nahi kiya. Pehle aisi bookings hamesha ke
  // liye 'confirmed' hi reh jaati thin — na refund hota, na user ko pata
  // chalta. Har 5 min check, jo bhi session apne end-time + 5 min grace ke
  // baad bhi 'confirmed' hai, wo automatically refund ho jaata hai.
  const paymentServiceForSweep = new PaymentService(paymentRepo, appointmentRepo, pushNotificationService)
  const missedSessionInterval = setInterval(async () => {
    recordCronRun(MISSED_SESSION_JOB)
    try {
      const count = await paymentServiceForSweep.refundMissedSessions()
      if (count > 0) {
        app.log.info({ count }, 'Refunded missed sessions')
      }
      recordCronSuccess(MISSED_SESSION_JOB)
    } catch (err) {
      app.log.error(err, 'Missed session refund sweep failed')
      recordCronError(MISSED_SESSION_JOB, err)
      pushLog('cron', 'error', 'Missed session refund sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, MISSED_SESSION_SWEEP_INTERVAL_MS)

  // ── Astrologer payout settlement (Cashfree Easy Split — the 8th of every
  // month) — commented out during the Razorpay rollback (kept, not deleted,
  // for a quick re-migration). Razorpay Route settles per-transfer, not on
  // a monthly cron, so this has no active equivalent right now.
  // const settlementInterval = setInterval(async () => {
  //   recordCronRun(SETTLEMENT_JOB)
  //   if (new Date().getUTCDate() !== 8) {
  //     recordCronSuccess(SETTLEMENT_JOB)
  //     return
  //   }
  //   try {
  //     const { settled, failed } = await runMonthlySettlement(getDb())
  //     app.log.info({ settled, failed }, 'Monthly vendor settlement run complete')
  //     recordCronSuccess(SETTLEMENT_JOB)
  //   } catch (err) {
  //     app.log.error(err, 'Monthly vendor settlement run failed')
  //     recordCronError(SETTLEMENT_JOB, err)
  //     pushLog('cron', 'error', 'Monthly vendor settlement run failed', {
  //       error: err instanceof Error ? err.message : String(err),
  //     })
  //   }
  // }, SETTLEMENT_INTERVAL_MS)

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`)
    sessionSweep.stop()
    clearInterval(notificationCleanupInterval)
    clearInterval(stalePendingCleanupInterval)
    clearInterval(missedSessionInterval)
    // clearInterval(settlementInterval)

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