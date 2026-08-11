// src/modules/astrologers/services/astrologer.service.ts
import { NotFoundError } from '@/core/errors'
import type { AstrologerRepository } from '../repositories/astrologer.repository'
import { AstrologerResponseSchema } from '../schemas/astrologer.schema'

export class AstrologerService {
  constructor(private readonly astrologerRepository: AstrologerRepository) {}

  async getAll(limit?: number, offset?: number) {
    const astrologers = await this.astrologerRepository.findAll(limit, offset)
    return astrologers.map((a) => AstrologerResponseSchema.parse(a))
  }

  async getById(id: string) {
    const astrologer = await this.astrologerRepository.findById(id)
    if (!astrologer) throw NotFoundError('Astrologer not found')
    return AstrologerResponseSchema.parse(astrologer)
  }

  async getServices(astrologerId: string) {
    // The existence check (findById) doesn't gate the services query —
    // both just need astrologerId. Running them one after another was
    // paying a full extra Neon round trip (~150-600ms observed) purely
    // to confirm something the services query itself would tell us.
    const [astrologer, services] = await Promise.all([
      this.astrologerRepository.findById(astrologerId),
      this.astrologerRepository.findServices(astrologerId),
    ])
    if (!astrologer) throw NotFoundError('Astrologer not found')
    return services
  }

  async getSlots(astrologerId: string) {
    const [astrologer, slots] = await Promise.all([
      this.astrologerRepository.findById(astrologerId),
      this.astrologerRepository.findSlots(astrologerId),
    ])
    if (!astrologer) throw NotFoundError('Astrologer not found')
    return slots
  }
}
