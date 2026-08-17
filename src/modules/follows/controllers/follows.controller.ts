import type { FastifyRequest, FastifyReply } from 'fastify'
import type { FollowsService } from '../services/follows.service'
import { GetFollowListQuerySchema } from '../schemas/follows.schema'

export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  // POST /follows/:astrologerId
  follow = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { astrologerId } = request.params as { astrologerId: string }
    await this.followsService.follow(user.userId, astrologerId)
    return reply.status(200).send({ success: true })
  }

  // DELETE /follows/:astrologerId
  unfollow = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { astrologerId } = request.params as { astrologerId: string }
    await this.followsService.unfollow(user.userId, astrologerId)
    return reply.status(200).send({ success: true })
  }

  // GET /follows/:userId/followers
  getFollowers = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string }
    const { limit, offset } = GetFollowListQuerySchema.parse(request.query)
    const followers = await this.followsService.getFollowers(userId, limit, offset)
    return reply.send({ success: true, data: { followers } })
  }

  // GET /follows/:userId/following
  getFollowing = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string }
    const { limit, offset } = GetFollowListQuerySchema.parse(request.query)
    const following = await this.followsService.getFollowing(userId, limit, offset)
    return reply.send({ success: true, data: { following } })
  }

  // GET /follows/:userId/counts
  getCounts = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string }
    const counts = await this.followsService.getCounts(userId)
    return reply.send({ success: true, data: counts })
  }

  // GET /follows/:astrologerId/status — current viewer follow karta hai ya nahi
  getStatus = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { astrologerId } = request.params as { astrologerId: string }
    const isFollowing = await this.followsService.isFollowing(user.userId, astrologerId)
    return reply.send({ success: true, data: { isFollowing } })
  }
}
