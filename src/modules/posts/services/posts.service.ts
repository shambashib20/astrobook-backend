import ImageKit from 'imagekit'
import { env } from '@/config/env'
import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { PostsRepository } from '../repositories/posts.repository'
import type { CreatePostDto, CreateCommentDto } from '../schemas/posts.schema'
import type { UserRepository } from '@/modules/users/repositories/user.repository'
import type { FollowsRepository } from '@/modules/follows/repositories/follows.repository'
import type { NotificationsService } from '@/modules/notifications/services/notifications.service'

export class PostsService {
  private imagekit: ImageKit

  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly userRepository?: UserRepository,
    private readonly followsRepository?: FollowsRepository,
    private readonly notificationsService?: NotificationsService,
  ) {
    this.imagekit = new ImageKit({
      publicKey: env.IMAGEKIT_PUBLIC_KEY ?? '',
      privateKey: env.IMAGEKIT_PRIVATE_KEY ?? '',
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT ?? '',
    })
  }

  // ── Create Post ────────────────────────────────────────────────────────────

  async createPost(astrologerId: string, dto: CreatePostDto) {
    if (dto.mediaType === 'VIDEO' && !dto.durationSeconds) {
      throw BadRequestError('Video post ke liye durationSeconds zaroori hai')
    }
    return this.postsRepository.create({
      astrologerId,
      content: dto.content,
      mediaUrl: dto.mediaUrl ?? null,
      mediaType: dto.mediaType,
      bgColor: dto.bgColor ?? null,
      textColor: dto.textColor ?? null,
      durationSeconds: dto.durationSeconds ?? null,
      linkedServiceId: dto.linkedServiceId ?? null,
      tags: dto.tags ?? [],
    })
  }

  // ── Get All Posts — feed / category detail ─────────────────────────────────

  async getAllPosts(
    limit: number,
    offset: number,
    astrologerId?: string,
    tag?: string,
    viewerId?: string,
  ) {
    if (astrologerId) {
      return this.postsRepository.findByAstrologer(astrologerId, limit, offset, viewerId)
    }
    if (tag) {
      return this.postsRepository.findByTag(tag, limit, offset, viewerId)
    }

    // Main feed — personalize only agar viewer ke paas kuch follow ya
    // interests hai. Naye user jinhone onboarding mein kuch select nahi
    // kiya (interests optional hai) aur abhi kisi ko follow nahi kiya,
    // unke liye empty feed dikhane se better hai poora feed dikhana
    // (fallback), warna app khaali lagegi.
    if (viewerId && this.userRepository && this.followsRepository) {
      const [viewer, followingIds] = await Promise.all([
        this.userRepository.findById(viewerId),
        this.followsRepository.listFollowingIds(viewerId),
      ])
      const interestTags = viewer?.interests ?? []

      if (followingIds.length > 0 || interestTags.length > 0) {
        return this.postsRepository.findPersonalized(
          limit,
          offset,
          followingIds,
          interestTags,
          viewerId,
        )
      }
    }

    return this.postsRepository.findAll(limit, offset, {}, viewerId)
  }

  async getPostById(id: string, viewerId?: string) {
    const post = await this.postsRepository.findById(id, viewerId)
    if (!post) throw NotFoundError('Post not found')
    return post
  }

  // ── Get My Posts — astrologer ──────────────────────────────────────────────

  async getMyPosts(astrologerId: string, limit: number, offset: number) {
    return this.postsRepository.findByAstrologer(astrologerId, limit, offset, astrologerId)
  }

  // ── Delete Post ────────────────────────────────────────────────────────────

  async deletePost(postId: string, userId: string) {
    const post = await this.postsRepository.findById(postId)
    if (!post) throw NotFoundError('Post not found')
    if (post.astrologerId !== userId) throw ForbiddenError('Tumhara post nahi hai')
    await this.postsRepository.delete(postId)
  }

  // ── Likes ──────────────────────────────────────────────────────────────────

  async likePost(postId: string, userId: string) {
    const post = await this.postsRepository.findById(postId)
    if (!post) throw NotFoundError('Post not found')
    const isNewLike = await this.postsRepository.like(postId, userId)

    // Sirf naye like pe notify (repeat tap pe nahi), aur apni khud ki post
    // like karne pe khud ko notify mat karo
    if (isNewLike && post.astrologerId !== userId && this.notificationsService) {
      const liker = this.userRepository ? await this.userRepository.findById(userId) : null
      await this.notificationsService.notifyPostLiked(
        post.astrologerId,
        userId,
        liker?.name ?? null,
        postId,
      )
    }
  }

  async unlikePost(postId: string, userId: string) {
    await this.postsRepository.unlike(postId, userId)
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  async addComment(postId: string, userId: string, dto: CreateCommentDto) {
    const post = await this.postsRepository.findById(postId)
    if (!post) throw NotFoundError('Post not found')
    return this.postsRepository.addComment({ postId, userId, content: dto.content })
  }

  async getComments(postId: string, limit: number, offset: number) {
    return this.postsRepository.listComments(postId, limit, offset)
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.postsRepository.findCommentById(commentId)
    if (!comment) throw NotFoundError('Comment not found')
    if (comment.userId !== userId) throw ForbiddenError('Tumhara comment nahi hai')
    await this.postsRepository.deleteComment(commentId)
  }

  // ── ImageKit Upload Auth Token ─────────────────────────────────────────────
  // Frontend seedha ImageKit pe upload karega — backend sirf token deta hai

  getImageKitAuthToken() {
    return this.imagekit.getAuthenticationParameters()
  }
}
