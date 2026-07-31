import { NotFoundError, BadRequestError } from '@/core/errors'
import type { UserRepository } from '../repositories/user.repository'
import type { ServiceRepository } from '@/modules/consultation/repositories/service.repository'
import type { OnboardingDto, UpdateProfileDto } from '../schemas/user.schema'

export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly serviceRepository: ServiceRepository,
  ) {}

  async onboardUser(userId: string, dto: OnboardingDto) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    if (user.isOnboarded) {
      throw BadRequestError('User is already onboarded')
    }

    return this.userRepository.updateOnboarding(userId, dto)
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    return user
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    return this.userRepository.updateProfile(userId, dto)
  }

  async upgradeToAstrologer(userId: string) {
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw NotFoundError('User not found')
    }

    if (user.isAstrologer) {
      throw BadRequestError('User is already an astrologer')
    }

    const upgraded = await this.userRepository.upgradeToAstrologer(userId)

    // Platform har naye astrologer ke liye ek default "Basic Consultation"
    // service auto-create karta hai (isBasic: true). Astrologer isko baad
    // mein price/duration edit kar sakta hai, but yeh delete nahi hoti aur
    // profile ke normal consultations list mein show nahi hoti — uski jagah
    // profile ke top pe "Book Now" CTA banti hai.
    await this.serviceRepository.createBasic(userId)

    return upgraded
  }
}