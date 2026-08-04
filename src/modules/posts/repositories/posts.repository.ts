import { eq, desc, asc, sql, and, getTableColumns } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { posts, postLikes, postComments, users } from '@/core/database/schema'
import type { NewPost, NewPostComment } from '@/core/database/schema/posts'

type FindFilters = {
  astrologerId?: string
  tag?: string
}

export class PostsRepository {
  constructor(private readonly db: Database) {}

  async create(data: NewPost) {
    const [post] = await this.db.insert(posts).values(data).returning()
    return post!
  }

  // ── Stats-enriched select helper ────────────────────────────────────────
  // likesCount, commentsCount, aur (agar viewerId diya ho) isLikedByMe —
  // correlated subqueries se, ek hi query mein (feed page-size par N+1 nahi banta)
  //
  // astrologerName/astrologerAvatar bhi yahin se aate hain (users table join
  // karke) — pehle yeh join nahi tha, isliye feed pe hamesha "Astrologer" +
  // emoji fallback hi dikhta tha, kabhi asli naam/photo nahi.
  private statsSelect(viewerId?: string) {
    return {
      ...getTableColumns(posts),
      astrologerName: users.name,
      astrologerAvatar: users.avatarUrl,
      likesCount: sql<number>`(SELECT COUNT(*)::int FROM ${postLikes} WHERE ${postLikes.postId} = ${posts.id})`,
      commentsCount: sql<number>`(SELECT COUNT(*)::int FROM ${postComments} WHERE ${postComments.postId} = ${posts.id})`,
      isLikedByMe: viewerId
        ? sql<boolean>`EXISTS(SELECT 1 FROM ${postLikes} WHERE ${postLikes.postId} = ${posts.id} AND ${postLikes.userId} = ${viewerId})`
        : sql<boolean>`false`,
    }
  }

  // Sabke posts — feed ke liye (latest first), optional astrologerId/tag filter
  async findAll(limit = 20, offset = 0, filters: FindFilters = {}, viewerId?: string) {
    const conditions = []
    if (filters.astrologerId) conditions.push(eq(posts.astrologerId, filters.astrologerId))
    if (filters.tag) conditions.push(sql`${filters.tag} = ANY(${posts.tags})`)

    return this.db
      .select(this.statsSelect(viewerId))
      .from(posts)
      .innerJoin(users, eq(posts.astrologerId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset)
  }

  // Ek astrologer ke posts
  async findByAstrologer(astrologerId: string, limit = 20, offset = 0, viewerId?: string) {
    return this.findAll(limit, offset, { astrologerId }, viewerId)
  }

  // Ek category/tag ke posts (Explore category detail page ke liye)
  async findByTag(tag: string, limit = 20, offset = 0, viewerId?: string) {
    return this.findAll(limit, offset, { tag }, viewerId)
  }

  async findById(id: string, viewerId?: string) {
    const [post] = await this.db
      .select(this.statsSelect(viewerId))
      .from(posts)
      .innerJoin(users, eq(posts.astrologerId, users.id))
      .where(eq(posts.id, id))
      .limit(1)
    return post ?? null
  }

  async delete(id: string) {
    await this.db.delete(posts).where(eq(posts.id, id))
  }

  // ── Likes ──────────────────────────────────────────────────────────────────

  async like(postId: string, userId: string) {
    // Duplicate like avoid karo — unique constraint hai bhi, lekin conflict
    // par silently ignore karna zyada saaf hai (idempotent behavior)
    await this.db
      .insert(postLikes)
      .values({ postId, userId })
      .onConflictDoNothing({ target: [postLikes.postId, postLikes.userId] })
  }

  async unlike(postId: string, userId: string) {
    await this.db
      .delete(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  async addComment(data: NewPostComment) {
    const [comment] = await this.db.insert(postComments).values(data).returning()
    return comment!
  }

  // Commenter ka naam bhi joined — frontend ko alag se fetch na karna pade
  async listComments(postId: string, limit = 30, offset = 0) {
    return this.db
      .select({
        id: postComments.id,
        postId: postComments.postId,
        userId: postComments.userId,
        content: postComments.content,
        createdAt: postComments.createdAt,
        userName: users.name,
      })
      .from(postComments)
      .innerJoin(users, eq(postComments.userId, users.id))
      .where(eq(postComments.postId, postId))
      .orderBy(asc(postComments.createdAt)) // chronological — jaisa WhatsApp/Instagram comments
      .limit(limit)
      .offset(offset)
  }

  async deleteComment(id: string) {
    await this.db.delete(postComments).where(eq(postComments.id, id))
  }

  async findCommentById(id: string) {
    const [comment] = await this.db
      .select()
      .from(postComments)
      .where(eq(postComments.id, id))
      .limit(1)
    return comment ?? null
  }
}