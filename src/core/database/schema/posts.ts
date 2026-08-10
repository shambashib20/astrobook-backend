import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, pgEnum, integer, unique, index } from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const mediaTypeEnum = pgEnum('media_type', ['IMAGE', 'VIDEO', 'TEXT'])

// ─── Posts ────────────────────────────────────────────────────────────────────

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    astrologerId: uuid('astrologer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    mediaUrl: text('media_url'), // ImageKit URL
    mediaType: mediaTypeEnum('media_type').default('TEXT'),
    // TEXT posts ke liye — astrologer khud background/text color choose karta hai
    // (pehle auto-hash se generate hota tha, ab deliberate choice hai)
    bgColor: text('bg_color'),
    textColor: text('text_color'),
    // VIDEO posts ke liye — client duration bhejta hai (soft validation, display ke liye)
    durationSeconds: integer('duration_seconds'),
    linkedServiceId: uuid('linked_service_id'), // optional — Book Now ke liye
    // Explore ke categories ke saath match karne ke liye — services.tags jaisi hi
    // ids (e.g. "vedic-astrology", "tarot"). Category detail page isi se posts filter karta hai.
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Astrologer profile feed — "get this astrologer's posts", sorted newest first.
    astrologerIdCreatedAtIdx: index('posts_astrologer_id_created_at_idx').on(
      table.astrologerId,
      table.createdAt,
    ),
    // Category detail page filters `tag = ANY(tags)` — a btree index can't
    // serve an array-containment predicate at all, so this was a full
    // table scan (evaluating the array on every row). GIN is the correct
    // index type for array membership.
    tagsGinIdx: index('posts_tags_gin_idx').using('gin', table.tags),
  }),
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert

// ─── Post Likes ─────────────────────────────────────────────────────────────

export const postLikes = pgTable(
  'post_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postUserUnique: unique().on(table.postId, table.userId),
    // (postId, userId) unique index covers postId lookups, but not
    // "posts liked by this user" queries — add userId separately.
    userIdIdx: index('post_likes_user_id_idx').on(table.userId),
  }),
)

export type PostLike = typeof postLikes.$inferSelect
export type NewPostLike = typeof postLikes.$inferInsert

// ─── Post Comments ──────────────────────────────────────────────────────────
// Flat hi rakha hai (koi nested replies nahi) — simple rakhne ke liye

export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // "Get comments for post" — the only read pattern on this table.
    postIdCreatedAtIdx: index('post_comments_post_id_created_at_idx').on(
      table.postId,
      table.createdAt,
    ),
  }),
)

export type PostComment = typeof postComments.$inferSelect
export type NewPostComment = typeof postComments.$inferInsert
