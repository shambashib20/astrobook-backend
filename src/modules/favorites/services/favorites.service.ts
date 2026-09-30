import type { FavoriteItemType } from '@/core/database/schema'
import { NotFoundError } from '@/core/errors'
import type { AstrologerRepository } from '@/modules/astrologers/repositories/astrologer.repository'
import type { ServiceRepository } from '@/modules/consultation/repositories/service.repository'
import type { FavoritesRepository } from '../repositories/favorites.repository'

export class FavoritesService {
  constructor(
    private readonly favoritesRepository: FavoritesRepository,
    private readonly serviceRepository: ServiceRepository,
    private readonly astrologerRepository: AstrologerRepository,
  ) {}

  async add(userId: string, itemType: FavoriteItemType, itemId: string) {
    await this.assertItemExists(itemType, itemId)
    await this.favoritesRepository.add(userId, itemType, itemId)
  }

  async remove(userId: string, itemType: FavoriteItemType, itemId: string) {
    // Item delete/inactive ho chuka ho tab bhi hata sako — isliye existence
    // check nahi karte
    await this.favoritesRepository.remove(userId, itemType, itemId)
  }

  async listIds(userId: string, itemType: FavoriteItemType) {
    return this.favoritesRepository.findItemIds(userId, itemType)
  }

  // Favourites screen ke liye enriched list. Jo item ab exist nahi karta ya
  // inactive hai (astrologer ne service band kar di) use dikhate nahi.
  async list(userId: string, itemType: FavoriteItemType) {
    const rows = await this.favoritesRepository.findByUser(userId, itemType)

    // Naye item types (course/product) yahan apna resolver add karenge.
    if (itemType === 'astrologer') return this.resolveAstrologers(rows)
    return this.resolveServices(rows)
  }

  // Favourite astrologers — listing wale card jaisa hi data. Astrologer ban
  // ho gaya / hat gaya to list se chhod dete hain (favourite row rehti hai).
  private async resolveAstrologers(rows: Awaited<ReturnType<FavoritesRepository['findByUser']>>) {
    const cards = await this.astrologerRepository.findCardsByIds(rows.map((r) => r.itemId))
    const cardMap = new Map(cards.map((c) => [c.id, c]))

    return rows.flatMap((row) => {
      const card = cardMap.get(row.itemId)
      if (!card) return []
      // Public list mein phone number nahi jaana chahiye
      const { phone: _phone, ...astrologer } = card
      return [
        {
          id: row.id,
          itemType: row.itemType,
          itemId: row.itemId,
          createdAt: row.createdAt,
          astrologer,
        },
      ]
    })
  }

  private async resolveServices(rows: Awaited<ReturnType<FavoritesRepository['findByUser']>>) {
    const services = await this.serviceRepository.findByIds(rows.map((r) => r.itemId))
    const activeServices = new Map(services.filter((s) => s.isActive).map((s) => [s.id, s]))

    const astrologerIds = Array.from(new Set([...activeServices.values()].map((s) => s.astrologerId)))
    const profiles = await this.favoritesRepository.findUserProfiles(astrologerIds)
    const profileMap = new Map(profiles.map((p) => [p.id, p]))

    return rows.flatMap((row) => {
      const service = activeServices.get(row.itemId)
      if (!service) return []
      const astrologer = profileMap.get(service.astrologerId)
      return [
        {
          id: row.id,
          itemType: row.itemType,
          itemId: row.itemId,
          createdAt: row.createdAt,
          service: {
            id: service.id,
            astrologerId: service.astrologerId,
            astrologerName: astrologer?.name ?? null,
            astrologerAvatarUrl: astrologer?.avatarUrl ?? null,
            isBasic: service.isBasic,
            title: service.title,
            shortDescription: service.shortDescription,
            coverImage: service.coverImage,
            durationMinutes: service.durationMinutes,
            price: service.price,
            tags: service.tags,
          },
        },
      ]
    })
  }

  private async assertItemExists(itemType: FavoriteItemType, itemId: string) {
    if (itemType === 'service') {
      const service = await this.serviceRepository.findById(itemId)
      if (!service || !service.isActive) throw NotFoundError('Service not found')
    }
    if (itemType === 'astrologer') {
      const astrologer = await this.astrologerRepository.findById(itemId)
      if (!astrologer) throw NotFoundError('Astrologer not found')
    }
  }
}
