import type { FastifyReply, FastifyRequest } from 'fastify'
import { getLatestVideos } from '../services/youtube.service'

interface GetLatestVideosQuery {
  limit?: number
}

export class YoutubeController {
  getLatest = async (
    request: FastifyRequest<{ Querystring: GetLatestVideosQuery }>,
    reply: FastifyReply,
  ) => {
    const limit = request.query.limit ?? 10
    const videos = await getLatestVideos(limit)
    return reply.send({ success: true, data: { videos } })
  }
}
