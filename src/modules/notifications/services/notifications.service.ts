import type { NotificationsRepository } from '../repositories/notifications.repository'
import type { PushNotificationService } from '@/core/services/push-notification.service'

const RETENTION_DAYS = 7

export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  async getList(userId: string, limit: number, offset: number) {
    return this.notificationsRepository.listForUser(userId, limit, offset)
  }

  async getUnreadCount(userId: string) {
    return this.notificationsRepository.countUnread(userId)
  }

  async markRead(id: string, userId: string) {
    await this.notificationsRepository.markRead(id, userId)
  }

  async markAllRead(userId: string) {
    await this.notificationsRepository.markAllRead(userId)
  }

  // ── Event helpers — jahan action hota hai wahin se call hote hain ──────────
  // (FollowsService.follow, PostsService.likePost) — DB row bhi banti hai
  // (list/badge ke liye) aur push bhi jaata hai (turant phone pe dikhe).
  // Push best-effort hai (PushNotificationService khud kabhi throw nahi
  // karta), lekin DB write fail nahi honi chahiye — agar hoti hai toh bhi
  // follow/like ka main action already ho chuka hai, isliye yahan try/catch
  // se silently log karte hain taaki notification fail hone se poora
  // follow/like flow na tootे.

  async notifyNewFollower(recipientId: string, actorId: string, actorName: string | null) {
    try {
      await this.notificationsRepository.create({
        userId: recipientId,
        type: 'new_follower',
        actorId,
      })
    } catch (err) {
      console.error('[Notifications] new_follower row create failed:', err)
    }

    await this.pushNotificationService.sendToUser(recipientId, {
      title: 'Naya Follower',
      body: `${actorName ?? 'Kisi ne'} aapko follow karna shuru kiya`,
      data: { type: 'new_follower', actorId },
    })
  }

  async notifyPostLiked(
    recipientId: string,
    actorId: string,
    actorName: string | null,
    postId: string,
  ) {
    try {
      await this.notificationsRepository.create({
        userId: recipientId,
        type: 'post_liked',
        actorId,
        postId,
      })
    } catch (err) {
      console.error('[Notifications] post_liked row create failed:', err)
    }

    await this.pushNotificationService.sendToUser(recipientId, {
      title: 'Naya Like',
      body: `${actorName ?? 'Kisi ne'} aapki post like ki`,
      data: { type: 'post_liked', postId },
    })
  }

  async notifyPostCommented(
    recipientId: string,
    actorId: string,
    actorName: string | null,
    postId: string,
  ) {
    try {
      await this.notificationsRepository.create({
        userId: recipientId,
        type: 'post_commented',
        actorId,
        postId,
      })
    } catch (err) {
      console.error('[Notifications] post_commented row create failed:', err)
    }

    await this.pushNotificationService.sendToUser(recipientId, {
      title: 'Naya Comment',
      body: `${actorName ?? 'Kisi ne'} aapki post pe comment kiya`,
      data: { type: 'post_commented', postId },
    })
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  // Cron sweep isse call karta hai (server.ts) — 7 din se purani sabhi
  // users ki notifications delete
  async cleanupOld() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    return this.notificationsRepository.deleteOlderThan(cutoff)
  }
}
