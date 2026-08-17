import { eq, and, count, lt, desc } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { notifications, users, posts } from '@/core/database/schema'
import type { NewNotification } from '@/core/database/schema/notifications'

export class NotificationsRepository {
  constructor(private readonly db: Database) {}

  async create(data: NewNotification) {
    const [row] = await this.db.insert(notifications).values(data).returning()
    return row!
  }

  // List ke liye — actor ka naam/avatar aur (agar post_liked/commented ho)
  // post ka content snippet bhi joined, taaki frontend ko alag se fetch na
  // karna pade
  async listForUser(userId: string, limit = 30, offset = 0) {
    return this.db
      .select({
        id: notifications.id,
        type: notifications.type,
        isRead: notifications.isRead,
        createdAt: notifications.createdAt,
        postId: notifications.postId,
        actorId: users.id,
        actorName: users.name,
        actorAvatar: users.avatarUrl,
        actorRole: users.role,
        postContent: posts.content,
      })
      .from(notifications)
      .innerJoin(users, eq(notifications.actorId, users.id))
      .leftJoin(posts, eq(notifications.postId, posts.id))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset)
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    return row?.count ?? 0
  }

  async markRead(id: string, userId: string) {
    // userId bhi where mein — taaki koi doosre ki notification ID guess
    // karke mark-read na kar sake
    await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
  }

  async markAllRead(userId: string) {
    await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
  }

  // 7-din se purani sabhi users ki notifications delete — cron sweep se
  // call hota hai (server.ts)
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoff))
      .returning({ id: notifications.id })
    return deleted.length
  }
}
