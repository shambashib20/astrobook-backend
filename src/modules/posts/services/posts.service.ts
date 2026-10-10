import ImageKit from 'imagekit'
import { env } from '@/config/env'
import { BadRequestError, ForbiddenError, NotFoundError } from '@/core/errors'
import type { PostsRepository } from '../repositories/posts.repository'
import type { CreatePostDto, CreateCommentDto, UpdatePostDto } from '../schemas/posts.schema'
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
      // Sticker — sirf IMAGE posts pe meaningful hai, lekin DB mein store karne
      // se koi harm nahi — frontend khud guard karta hai (sirf IMAGE pe send karta hai)
      stickerText: dto.stickerText ?? null,
      stickerX: dto.stickerX != null ? String(dto.stickerX) : null,
      stickerY: dto.stickerY != null ? String(dto.stickerY) : null,
      stickerTextColor: dto.stickerTextColor ?? null,
      stickerBgColor: dto.stickerBgColor ?? null,
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

    // Main feed — SARI posts aati hain (no filter), sirf ORDER badalta hai.
    // Viewer ke interests/following ke basis pe score milta hai:
    //   interest match → +1000, following → +500, engagement → +likes*2+comments
    // New user (no interests, no following) → effectively trending feed.
    // Experienced user → interest posts pehle, baki baad mein — sab dikhte hain.
    if (viewerId && this.userRepository && this.followsRepository) {
      const [viewer, followingIds] = await Promise.all([
        this.userRepository.findById(viewerId),
        this.followsRepository.listFollowingIds(viewerId),
      ])
      const interestTags = viewer?.interests ?? []
      return this.postsRepository.findFeed(limit, offset, viewerId, interestTags, followingIds)
    }

    // No viewer (unauthenticated) → engagement-sorted trending feed
    return this.postsRepository.findFeed(limit, offset)
  }

  async getPostById(id: string, viewerId?: string) {
    const post = await this.postsRepository.findById(id, viewerId)
    if (!post) throw NotFoundError('Post not found')
    return post
  }

  // ── Related posts — post detail ke neeche ──────────────────────────────────

  async getRelatedPosts(postId: string, limit: number, viewerId?: string) {
    const post = await this.postsRepository.findById(postId)
    if (!post) throw NotFoundError('Post not found')
    return this.postsRepository.findRelated(
      postId,
      post.tags ?? [],
      post.astrologerId,
      limit,
      viewerId,
    )
  }

  // ── Get My Posts — astrologer ──────────────────────────────────────────────

  async getMyPosts(astrologerId: string, limit: number, offset: number) {
    return this.postsRepository.findByAstrologer(astrologerId, limit, offset, astrologerId)
  }

  // ── Edit Post — sirf apna; media nahi badalta ───────────────────────────────

  async updatePost(postId: string, userId: string, dto: UpdatePostDto) {
    const post = await this.postsRepository.findById(postId)
    if (!post) throw NotFoundError('Post not found')
    if (post.astrologerId !== userId) throw ForbiddenError('Tumhara post nahi hai')

    const isText = post.mediaType === 'TEXT'
    await this.postsRepository.update(postId, {
      content: dto.content,
      tags: dto.tags,
      // Colours sirf TEXT post par maayne rakhte hain
      bgColor: isText ? dto.bgColor : undefined,
      textColor: isText ? dto.textColor : undefined,
    })
    return this.postsRepository.findById(postId, userId)
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
