import { eq, desc, asc, sql, and, or, inArray, getTableColumns } from 'drizzle-orm'
import type { Database } from '@/core/database/client'
import { posts, postLikes, postComments, users, consultationServices, follows } from '@/core/database/schema'
import type { NewPost, NewPostComment } from '@/core/database/schema/posts'

type FindFilters = {
  astrologerId?: string
  tag?: string
  // Home feed personalization — jab dono diye ho (aur non-empty ho), sirf
  // woh posts aate hain jo (a) followed astrologers ke hain, YA (b) jinke
  // tags viewer ke interests se overlap karte hain. Agar dono empty hain
  // (naya user, kisi ko follow nahi kiya, koi interest select nahi kiya)
  // toh koi filter nahi lagta — poora feed dikhta hai, warna feed hamesha
  // khaali rahega naye users ke liye.
  followingIds?: string[]
  interestTags?: string[]
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
      // Feed pe follow button ke liye — isLikedByMe jaisa hi pattern,
      // ek hi query mein aata hai (alag follow-status call nahi lagti
      // har post/astrologer ke liye)
      isFollowedByMe: viewerId
        ? sql<boolean>`EXISTS(SELECT 1 FROM ${follows} WHERE ${follows.followingId} = ${posts.astrologerId} AND ${follows.followerId} = ${viewerId})`
        : sql<boolean>`false`,
      // Feed pe "Book Now" ke liye — pehle frontend har unique astrologer ke
      // liye alag getServices() call karta tha post-fetch ke baad (N parallel
      // Neon round trips). Ab yahin correlated subquery se aata hai, koi
      // extra request nahi lagti.
      basicServiceId: sql<string | null>`(SELECT id FROM ${consultationServices} WHERE ${consultationServices.astrologerId} = ${posts.astrologerId} AND ${consultationServices.isBasic} = true AND ${consultationServices.isActive} = true LIMIT 1)`,
    }
  }

  // Sabke posts — feed ke liye (latest first), optional astrologerId/tag filter
  async findAll(limit = 20, offset = 0, filters: FindFilters = {}, viewerId?: string) {
    const conditions = []
    if (filters.astrologerId) conditions.push(eq(posts.astrologerId, filters.astrologerId))
    if (filters.tag) conditions.push(sql`${filters.tag} = ANY(${posts.tags})`)

    const hasFollowing = (filters.followingIds?.length ?? 0) > 0
    const hasInterests = (filters.interestTags?.length ?? 0) > 0
    if (hasFollowing || hasInterests) {
      const personalizeConditions = []
      if (hasFollowing) personalizeConditions.push(inArray(posts.astrologerId, filters.followingIds!))
      if (hasInterests) {
        // NOTE: `${filters.interestTags}` interpolated directly expands into
        // multiple positional params ($4, $5, $6) — a row/record literal,
        // not a Postgres array — so `(...)::text[]` fails with "cannot cast
        // type record to text[]". Building an explicit ARRAY[...] literal
        // via sql.join avoids that.
        const tagsArray = sql.join(
          filters.interestTags!.map((t) => sql`${t}`),
          sql`, `,
        )
        personalizeConditions.push(sql`${posts.tags} && ARRAY[${tagsArray}]::text[]`)
      }
      conditions.push(or(...personalizeConditions)!)
    }

    return this.db
      .select(this.statsSelect(viewerId))
      .from(posts)
      .innerJoin(users, eq(posts.astrologerId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset)
  }

  // Home feed personalization — PostsService.getAllPosts isse call karta
  // hai jab viewer ke paas following/interests ho. findAll ka hi wrapper
  // hai, sirf named zyada clear hai call-site pe.
  async findPersonalized(
    limit: number,
    offset: number,
    followingIds: string[],
    interestTags: string[],
    viewerId?: string,
  ) {
    return this.findAll(limit, offset, { followingIds, interestTags }, viewerId)
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

  async like(postId: string, userId: string): Promise<boolean> {
    // Duplicate like avoid karo — unique constraint hai bhi, lekin conflict
    // par silently ignore karna zyada saaf hai (idempotent behavior).
    // Return value se pata chalta hai naya like tha ya repeat tap —
    // notification sirf naye like pe jaani chahiye
    const [row] = await this.db
      .insert(postLikes)
      .values({ postId, userId })
      .onConflictDoNothing({ target: [postLikes.postId, postLikes.userId] })
      .returning({ id: postLikes.id })
    return !!row
  }

  async unlike(postId: string, userId: string) {
    await this.db
      .delete(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  async addComment(data: NewPostComment) {
    const [comment] = await this.db.insert(postComments).values(data).returning()

    // listComments jaisa hi shape chahiye (userName included) — warna
    // frontend jo naya comment turant list mein append karta hai usme
    // naam blank dikhta tha, jab tak page refresh na ho (listComments
    // yahi join karta hai, lekin insert().returning() sirf postComments
    // ke columns deta hai, users join nahi karta)
    const [withUser] = await this.db
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
      .where(eq(postComments.id, comment!.id))
      .limit(1)

    return withUser!
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