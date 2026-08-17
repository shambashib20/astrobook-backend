import { BadRequestError, NotFoundError } from '@/core/errors'
import type { UserRepository } from '@/modules/users/repositories/user.repository'
import type { FollowsRepository } from '../repositories/follows.repository'
import type { NotificationsService } from '@/modules/notifications/services/notifications.service'

export class FollowsService {
  constructor(
    private readonly followsRepository: FollowsRepository,
    private readonly userRepository: UserRepository,
    private readonly notificationsService?: NotificationsService,
  ) {}

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw BadRequestError('Khud ko follow nahi kar sakte')
    }

    const target = await this.userRepository.findById(followingId)
    if (!target) throw NotFoundError('User not found')

    // Sirf astrologers follow ho sakte hain — plain users ke followers
    // ka concept hi nahi hai (public profile nahi hai unki)
    if (!target.isAstrologer) {
      throw BadRequestError('Sirf astrologers ko follow kar sakte ho')
    }

    const isNewFollow = await this.followsRepository.follow(followerId, followingId)

    // Sirf tabhi notify karo jab yeh GENUINELY naya follow ho — repeat
    // taps (already-following state pe dobara follow call) idempotent
    // rehte hain DB mein, lekin notification spam nahi honi chahiye
    if (isNewFollow && this.notificationsService) {
      const follower = await this.userRepository.findById(followerId)
      await this.notificationsService.notifyNewFollower(followingId, followerId, follower?.name ?? null)
    }
  }

  async unfollow(followerId: string, followingId: string) {
    await this.followsRepository.unfollow(followerId, followingId)
  }

  async getFollowers(userId: string, limit: number, offset: number) {
    return this.followsRepository.findFollowers(userId, limit, offset)
  }

  async getFollowing(userId: string, limit: number, offset: number) {
    return this.followsRepository.findFollowing(userId, limit, offset)
  }

  async getCounts(userId: string) {
    const [followers, following] = await Promise.all([
      this.followsRepository.countFollowers(userId),
      this.followsRepository.countFollowing(userId),
    ])
    return { followers, following }
  }

  async isFollowing(followerId: string, followingId: string) {
    return this.followsRepository.isFollowing(followerId, followingId)
  }
}
