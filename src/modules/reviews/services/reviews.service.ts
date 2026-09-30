import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { ReviewsRepository } from '../repositories/reviews.repository'
import type { SubmitReviewDto } from '../schemas/reviews.schema'

// "Rahul Sharma" -> "Rahul S." — public review mein poora naam nahi dikhate
function toDisplayName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Astrobook user'
  if (parts.length === 1) return parts[0]!
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`
}

export class ReviewsService {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  // Create ya update (same endpoint) — sirf apni completed session ke liye
  async submit(userId: string, appointmentId: string, dto: SubmitReviewDto) {
    const appointment = await this.reviewsRepository.findAppointment(appointmentId)
    if (!appointment) throw NotFoundError('Appointment not found')
    if (appointment.userId !== userId) {
      throw ForbiddenError('Aap sirf apni session ko review kar sakte ho')
    }
    if (appointment.status !== 'completed') {
      throw BadRequestError('Review sirf complete hui session ke baad de sakte ho')
    }

    return this.reviewsRepository.upsert({
      appointmentId,
      userId,
      astrologerId: appointment.astrologerId,
      rating: dto.rating,
      comment: dto.comment,
    })
  }

  async remove(userId: string, appointmentId: string) {
    const deleted = await this.reviewsRepository.deleteByAppointment(appointmentId, userId)
    if (!deleted) throw NotFoundError('Review not found')
  }

  async listMine(userId: string) {
    return this.reviewsRepository.listByUser(userId)
  }

  async listForAstrologer(astrologerId: string, limit: number, offset: number) {
    const [rows, distribution] = await Promise.all([
      this.reviewsRepository.listForAstrologer(astrologerId, limit, offset),
      this.reviewsRepository.distributionForAstrologer(astrologerId),
    ])

    const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let total = 0
    let sum = 0
    for (const d of distribution) {
      if (d.rating >= 1 && d.rating <= 5) {
        counts[d.rating as 1 | 2 | 3 | 4 | 5] = d.count
        total += d.count
        sum += d.rating * d.count
      }
    }

    return {
      summary: {
        average: total > 0 ? Math.round((sum / total) * 100) / 100 : 0,
        total,
        distribution: counts,
      },
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        reviewer: { name: toDisplayName(r.reviewerName), avatarUrl: r.reviewerAvatarUrl },
      })),
    }
  }
}
