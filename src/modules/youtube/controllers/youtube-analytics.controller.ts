import { BadRequestError } from '@/core/errors'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { getBestPerformingVideo, getChannelSubscriberStats } from '../services/youtube-analytics.service'

interface GetChannelStatsQuery {
  from?: string
  to?: string
}

export class YoutubeAnalyticsController {
  getChannelStats = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as GetChannelStatsQuery
    const now = new Date()
    // Default range: start of the current calendar month → now, so "the
    // best performing video" with no filter matches the "this month" view
    // an admin would otherwise open the YT dashboard to check.
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    const from = query.from ? new Date(query.from) : defaultFrom
    const to = query.to ? new Date(query.to) : now

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw BadRequestError('Invalid `from`/`to` date — use YYYY-MM-DD format')
    }
    if (from > to) {
      throw BadRequestError('`from` date must not be after `to` date')
    }

    const [subscribers, bestVideo] = await Promise.all([
      getChannelSubscriberStats(),
      getBestPerformingVideo(from, to),
    ])

    return reply.send({ success: true, data: { subscribers, bestVideo } })
  }
}
