import { sql } from 'drizzle-orm'
import { getDb } from '@/core/database/client'
import { categoryMedia, posts, users } from '@/core/database/schema'
import type { FastifyInstance } from 'fastify'
import { ALL_CATEGORIES, CATEGORY_FILTERS } from '../constants'

export async function categoriesRoutes(app: FastifyInstance) {
  // GET /categories — Explore ke top filter tabs + saari categories (with hero media)
  app.get(
    '/categories',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Get Explore category taxonomy with hero media URLs',
      },
    },
    async (_request, reply) => {
      // Hero video/image URLs — DB se fetch karo aur category slugs se match karo.
      // Agar table khaali hai toh koi dikkat nahi — categories tab bhi chalti hain.
      const db = getDb()
      const mediaRows = await db.select().from(categoryMedia)
      const mediaMap: Record<string, { heroVideoUrl: string | null; heroImageUrl: string | null }> = {}
      for (const row of mediaRows) {
        mediaMap[row.id] = {
          heroVideoUrl: row.heroVideoUrl ?? null,
          heroImageUrl: row.heroImageUrl ?? null,
        }
      }

      const categories = ALL_CATEGORIES.map((cat) => ({
        ...cat,
        heroVideoUrl: mediaMap[cat.id]?.heroVideoUrl ?? null,
        heroImageUrl: mediaMap[cat.id]?.heroImageUrl ?? null,
      }))

      return reply.send({
        success: true,
        data: {
          filters: CATEGORY_FILTERS,
          categories,
        },
      })
    },
  )

  // GET /categories/:id/stats — category detail page ke liye quick stats
  // Returns: post count, unique user (viewer) count + sample avatars for
  // "Trusted by X users" section.
  app.get(
    '/categories/:id/stats',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Quick stats for a category detail page',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { id: categoryId } = request.params as { id: string }
      const db = getDb()

      // Parallel: post count + users interested in this category + sample avatars
      // sql`${categoryId}` = safe parameterized binding — no SQL injection
      const [postCountResult, interestedUsersResult, sampleAvatarsResult] = await Promise.all([
        // Posts count for this category tag
        db.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text AS count
              FROM ${posts}
              WHERE ${categoryId} = ANY(tags)`,
        ),

        // Distinct users who have this category in their interests
        db.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text AS count
              FROM ${users}
              WHERE ${categoryId} = ANY(interests)
              AND role = 'user'`,
        ),

        // Sample avatars (max 5) from interested users
        db.execute<{ avatar_url: string | null }>(
          sql`SELECT avatar_url
              FROM ${users}
              WHERE ${categoryId} = ANY(interests)
              AND role = 'user'
              AND avatar_url IS NOT NULL
              LIMIT 5`,
        ),
      ])

      const postCount = parseInt((postCountResult.rows[0] as any)?.count ?? '0', 10)
      const interestedCount = parseInt((interestedUsersResult.rows[0] as any)?.count ?? '0', 10)
      const sampleAvatars = (sampleAvatarsResult.rows as any[])
        .map((r) => r.avatar_url as string)
        .filter(Boolean)

      return reply.send({
        success: true,
        data: {
          categoryId,
          postCount,
          interestedUserCount: interestedCount,
          sampleAvatars,
        },
      })
    },
  )
}
