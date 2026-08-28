import { env } from '@/config/env'
import { assertYoutubeConfigured, resolveUploadsPlaylistId, ytFetch } from './youtube-client'

/**
 * Admin-panel YouTube analytics — live subscriber count + "best performing
 * video" within an arbitrary date range.
 *
 * "Best performing" here means: among videos UPLOADED within [from, to],
 * whichever currently has the most views. This only needs the public Data
 * API v3 (API key), not the YouTube Analytics API — it does NOT mean "most
 * views gained during that window" (that would require OAuth consent from
 * the channel owner via the Analytics API, a separate, heavier setup).
 */

export interface ChannelSubscriberStats {
  subscriberCount: number | null
  hidden: boolean
  viewCount: number
  videoCount: number
}

export interface BestVideoSummary {
  videoId: string
  title: string
  thumbnailUrl: string
  url: string
  publishedAt: string
  viewCount: number
  likeCount: number
  commentCount: number
}

export interface BestVideoResult {
  video: BestVideoSummary | null
  videosConsidered: number
  range: { from: string; to: string }
}

let subscriberCache: { stats: ChannelSubscriberStats; fetchedAt: number } | null = null
const SUBSCRIBER_CACHE_TTL_MS = 60_000

export async function getChannelSubscriberStats(): Promise<ChannelSubscriberStats> {
  assertYoutubeConfigured()

  if (subscriberCache && Date.now() - subscriberCache.fetchedAt < SUBSCRIBER_CACHE_TTL_MS) {
    return subscriberCache.stats
  }

  const body = await ytFetch<{
    items?: Array<{
      statistics?: {
        subscriberCount?: string
        hiddenSubscriberCount?: boolean
        viewCount?: string
        videoCount?: string
      }
    }>
  }>('/channels', { part: 'statistics', id: env.YOUTUBE_CHANNEL_ID! })

  const stats = body.items?.[0]?.statistics
  const result: ChannelSubscriberStats = {
    subscriberCount: stats?.hiddenSubscriberCount ? null : Number(stats?.subscriberCount ?? 0),
    hidden: Boolean(stats?.hiddenSubscriberCount),
    viewCount: Number(stats?.viewCount ?? 0),
    videoCount: Number(stats?.videoCount ?? 0),
  }

  subscriberCache = { stats: result, fetchedAt: Date.now() }
  return result
}

const bestVideoCache = new Map<string, { result: BestVideoResult; fetchedAt: number }>()
const BEST_VIDEO_CACHE_TTL_MS = 10 * 60_000
// 20 pages * 50 items = up to 1000 most recent uploads scanned before giving
// up — comfortably covers any realistic single-range window without letting
// a bad `from` date (e.g. the channel's founding year) walk the entire
// upload history on every request.
const MAX_PAGES_TO_SCAN = 20

export async function getBestPerformingVideo(from: Date, to: Date): Promise<BestVideoResult> {
  assertYoutubeConfigured()

  const cacheKey = `${from.toISOString()}|${to.toISOString()}`
  const cached = bestVideoCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < BEST_VIDEO_CACHE_TTL_MS) {
    return cached.result
  }

  const uploadsPlaylistId = await resolveUploadsPlaylistId()

  // playlistItems comes back newest-first, so once an item is older than
  // `from` everything after it is too — safe to stop paginating there.
  const candidateIds: string[] = []
  let pageToken: string | undefined
  let pagesScanned = 0
  let exhausted = false

  while (pagesScanned < MAX_PAGES_TO_SCAN && !exhausted) {
    const body = await ytFetch<{
      items?: Array<{ snippet?: { resourceId?: { videoId?: string }; publishedAt?: string } }>
      nextPageToken?: string
    }>('/playlistItems', {
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    })
    pagesScanned++

    for (const item of body.items ?? []) {
      const publishedAt = item.snippet?.publishedAt
      const videoId = item.snippet?.resourceId?.videoId
      if (!publishedAt || !videoId) continue

      const publishedDate = new Date(publishedAt)
      if (publishedDate < from) {
        exhausted = true
        break
      }
      if (publishedDate <= to) {
        candidateIds.push(videoId)
      }
    }

    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }

  if (candidateIds.length === 0) {
    const result: BestVideoResult = {
      video: null,
      videosConsidered: 0,
      range: { from: from.toISOString(), to: to.toISOString() },
    }
    bestVideoCache.set(cacheKey, { result, fetchedAt: Date.now() })
    return result
  }

  // videos.list caps at 50 ids per call — chunk defensively even though a
  // single-month window rarely produces more than that.
  const chunks: string[][] = []
  for (let i = 0; i < candidateIds.length; i += 50) {
    chunks.push(candidateIds.slice(i, i + 50))
  }

  let best: BestVideoSummary | null = null

  for (const chunk of chunks) {
    const body = await ytFetch<{
      items?: Array<{
        id: string
        snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> }
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
      }>
    }>('/videos', { part: 'snippet,statistics', id: chunk.join(',') })

    for (const item of body.items ?? []) {
      const viewCount = Number(item.statistics?.viewCount ?? 0)
      if (!best || viewCount > best.viewCount) {
        const thumbnail =
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          ''
        best = {
          videoId: item.id,
          title: item.snippet?.title ?? '',
          thumbnailUrl: thumbnail,
          url: `https://www.youtube.com/watch?v=${item.id}`,
          publishedAt: item.snippet?.publishedAt ?? '',
          viewCount,
          likeCount: Number(item.statistics?.likeCount ?? 0),
          commentCount: Number(item.statistics?.commentCount ?? 0),
        }
      }
    }
  }

  const result: BestVideoResult = {
    video: best,
    videosConsidered: candidateIds.length,
    range: { from: from.toISOString(), to: to.toISOString() },
  }
  bestVideoCache.set(cacheKey, { result, fetchedAt: Date.now() })
  return result
}
