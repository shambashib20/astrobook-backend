import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PostsService } from '../services/posts.service'
import {
  CreatePostSchema,
  CreateCommentSchema,
  UpdatePostSchema,
  GetPostsQuerySchema,
  GetRelatedQuerySchema,
  PostIdParamSchema,
} from '../schemas/posts.schema'

export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // POST /posts — astrologer only
  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string; role: string }
    const dto = CreatePostSchema.parse(request.body)
    const post = await this.postsService.createPost(user.userId, dto)
    return reply.status(201).send({ success: true, data: { post } })
  }

  // GET /posts — sabke posts (feed), ya ?astrologerId=X / ?tag=X se filtered
  // Optional auth — agar logged in hai toh isLikedByMe bhi milega
  getAll = async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit, offset, astrologerId, tag } = GetPostsQuerySchema.parse(request.query)
    const viewerId = (request.user as { userId: string } | undefined)?.userId
    const posts = await this.postsService.getAllPosts(limit, offset, astrologerId, tag, viewerId)
    // Infinite scroll ke liye: agar poore `limit` jitne posts mile, aur pages ho sakte hain
    const hasMore = posts.length === limit
    return reply.send({ success: true, data: { posts, hasMore } })
  }

  // GET /posts/:id — single post detail (public, optional auth)
  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const viewerId = (request.user as { userId: string } | undefined)?.userId
    const post = await this.postsService.getPostById(id, viewerId)
    return reply.send({ success: true, data: { post } })
  }

  // GET /posts/:id/related?limit=3 — same category ke posts (public, optional auth)
  getRelated = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = PostIdParamSchema.parse(request.params)
    const { limit } = GetRelatedQuerySchema.parse(request.query)
    const viewerId = (request.user as { userId: string } | undefined)?.userId
    const posts = await this.postsService.getRelatedPosts(id, limit, viewerId)
    return reply.send({ success: true, data: { posts } })
  }

  // GET /posts/my — apne posts
  getMy = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { limit, offset } = GetPostsQuerySchema.parse(request.query)
    const posts = await this.postsService.getMyPosts(user.userId, limit, offset)
    return reply.send({ success: true, data: { posts } })
  }

  // PATCH /posts/:id — apna post edit (caption / categories / text colours)
  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { id } = PostIdParamSchema.parse(request.params)
    const dto = UpdatePostSchema.parse(request.body)
    const post = await this.postsService.updatePost(id, user.userId, dto)
    return reply.send({ success: true, data: { post } })
  }

  // DELETE /posts/:id
  delete = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.postsService.deletePost(id, user.userId)
    return reply.send({ success: true })
  }

  // GET /posts/upload-token — ImageKit signed token (no-store to prevent browser caching same token)
  getUploadToken = async (_request: FastifyRequest, reply: FastifyReply) => {
    const token = this.postsService.getImageKitAuthToken()
    reply.header('Cache-Control', 'no-store')
    return reply.send({ success: true, data: token })
  }

  // ── Likes ──────────────────────────────────────────────────────────────────

  like = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.postsService.likePost(id, user.userId)
    return reply.status(200).send({ success: true })
  }

  unlike = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { id } = request.params as { id: string }
    await this.postsService.unlikePost(id, user.userId)
    return reply.status(200).send({ success: true })
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  addComment = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { id } = request.params as { id: string }
    const dto = CreateCommentSchema.parse(request.body)
    const comment = await this.postsService.addComment(id, user.userId, dto)
    return reply.status(201).send({ success: true, data: { comment } })
  }

  getComments = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const { limit, offset } = GetPostsQuerySchema.pick({ limit: true, offset: true }).parse(
      request.query,
    )
    const comments = await this.postsService.getComments(id, limit, offset)
    return reply.send({ success: true, data: { comments } })
  }

  deleteComment = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { userId: string }
    const { commentId } = request.params as { commentId: string }
    await this.postsService.deleteComment(commentId, user.userId)
    return reply.send({ success: true })
  }
}
