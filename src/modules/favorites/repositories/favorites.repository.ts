import type { Database } from '@/core/database/client'
import { favorites, users } from '@/core/database/schema'
import type { FavoriteItemType } from '@/core/database/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'

export class FavoritesRepository {
  constructor(private readonly db: Database) {}

  // Idempotent — pehle se favourite ho to conflict pe kuch nahi karta
  async add(userId: string, itemType: FavoriteItemType, itemId: string) {
    await this.db
      .insert(favorites)
      .values({ userId, itemType, itemId })
      .onConflictDoNothing({ target: [favorites.userId, favorites.itemType, favorites.itemId] })
  }

  async remove(userId: string, itemType: FavoriteItemType, itemId: string) {
    await this.db
      .delete(favorites)
      .where(
        and(
          eq(favorites.userId, userId),
          eq(favorites.itemType, itemType),
          eq(favorites.itemId, itemId),
        ),
      )
  }

  // Naye favourite pehle
  async findByUser(userId: string, itemType: FavoriteItemType) {
    return this.db
      .select()
      .from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.itemType, itemType)))
      .orderBy(desc(favorites.createdAt))
  }

  // Card pe heart ki state ke liye — sirf ids, poori rows nahi
  async findItemIds(userId: string, itemType: FavoriteItemType) {
    const rows = await this.db
      .select({ itemId: favorites.itemId })
      .from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.itemType, itemType)))
    return rows.map((r) => r.itemId)
  }

  // Favourites list mein astrologer ka naam/photo dikhane ke liye
  async findUserProfiles(ids: string[]) {
    if (ids.length === 0) return []
    return this.db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, ids))
  }
}
