import { env } from '@/config/env'
import { assertYoutubeConfigured, resolveUploadsPlaylistId, ytFetch } from './youtube-client'

/**
 * YouTube Data API v3 — latest uploads for Astrobook's channel.
 *
 * Uses channels.list (1 quota unit, via resolveUploadsPlaylistId) once to
 * resolve the channel's "uploads" playlist id, then playlistItems.list
 * (1 unit) to page that playlist — together far cheaper than search.list
 * (100 units per call) for the same "latest videos" result. The video list
 * itself is cached for YOUTUBE_CACHE_TTL_MS to keep this public, unthrottled
 * route from burning API quota on every visitor.
 */

export interface YoutubeVideoSummary {
  videoId: string
  title: string
  description: string
  publishedAt: string
  thumbnailUrl: string
  url: string
}

let videoCache: { videos: YoutubeVideoSummary[]; fetchedAt: number } | null = null

export async function getLatestVideos(maxResults = 10): Promise<YoutubeVideoSummary[]> {
  assertYoutubeConfigured()

  const isFresh = videoCache && Date.now() - videoCache.fetchedAt < env.YOUTUBE_CACHE_TTL_MS
  if (isFresh && videoCache!.videos.length >= maxResults) {
    return videoCache!.videos.slice(0, maxResults)
  }

  const uploadsPlaylistId = await resolveUploadsPlaylistId()

  const body = await ytFetch<{
    items?: Array<{
      snippet?: {
        title?: string
        description?: string
        publishedAt?: string
        resourceId?: { videoId?: string }
        thumbnails?: Record<string, { url?: string }>
      }
    }>
  }>('/playlistItems', {
    part: 'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults),
  })

  const videos: YoutubeVideoSummary[] = (body.items ?? [])
    .filter((item) => item.snippet?.resourceId?.videoId)
    .map((item) => {
      const videoId = item.snippet!.resourceId!.videoId as string
      const thumbnail =
        item.snippet!.thumbnails?.high?.url ??
        item.snippet!.thumbnails?.medium?.url ??
        item.snippet!.thumbnails?.default?.url ??
        ''
      return {
        videoId,
        title: item.snippet!.title ?? '',
        description: item.snippet!.description ?? '',
        publishedAt: item.snippet!.publishedAt ?? '',
        thumbnailUrl: thumbnail,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      }
    })

  videoCache = { videos, fetchedAt: Date.now() }
  return videos.slice(0, maxResults)
}
