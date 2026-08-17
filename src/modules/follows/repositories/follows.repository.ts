import { eq, and, count } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { follows, users } from '@/core/database/schema'

export class FollowsRepository {
  constructor(private readonly db: Database) {}

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: follows.id })
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
      .limit(1)
    return !!row
  }

  async follow(followerId: string, followingId: string): Promise<boolean> {
    // Duplicate follow avoid karo — unique constraint hai bhi, lekin
    // conflict par silently ignore karna zyada saaf hai (idempotent, jaise
    // postLikes mein hai). Return value bataata hai ki row NAYI bani ya
    // pehle se follow tha — caller (service) isse decide karta hai ki
    // notification bhejni hai ya nahi (warna repeat taps pe spam ho jaata)
    const [row] = await this.db
      .insert(follows)
      .values({ followerId, followingId })
      .onConflictDoNothing({ target: [follows.followerId, follows.followingId] })
      .returning({ id: follows.id })
    return !!row
  }

  async unfollow(followerId: string, followingId: string) {
    await this.db
      .delete(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
  }

  async countFollowers(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(follows)
      .where(eq(follows.followingId, userId))
    return row?.count ?? 0
  }

  async countFollowing(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(follows)
      .where(eq(follows.followerId, userId))
    return row?.count ?? 0
  }

  // "Iske followers kaun hain" — kisne is user (usually astrologer) ko follow kiya
  async findFollowers(userId: string, limit = 30, offset = 0) {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
        followedAt: follows.createdAt,
      })
      .from(follows)
      .innerJoin(users, eq(follows.followerId, users.id))
      .where(eq(follows.followingId, userId))
      .orderBy(follows.createdAt)
      .limit(limit)
      .offset(offset)
  }

  // "Yeh kisko follow karta hai" — user ne kin astrologers ko follow kiya
  async findFollowing(userId: string, limit = 30, offset = 0) {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
        followedAt: follows.createdAt,
      })
      .from(follows)
      .innerJoin(users, eq(follows.followingId, users.id))
      .where(eq(follows.followerId, userId))
      .orderBy(follows.createdAt)
      .limit(limit)
      .offset(offset)
  }

  // Feed personalization ke liye — is user ne jin astrologers ko follow
  // kiya hai unki id list (posts.repository ke findAll filter mein use hogi)
  async listFollowingIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, userId))
    return rows.map((r) => r.followingId)
  }
}
