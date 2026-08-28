import { env } from '@/config/env'
import { InternalError } from '@/core/errors'

/**
 * Shared low-level plumbing for the YouTube Data API v3 — used by both the
 * public "latest videos" feed (youtube.service.ts) and the admin analytics
 * endpoint (youtube-analytics.service.ts) so the uploads-playlist lookup and
 * the API-key/fetch boilerplate aren't duplicated between them.
 */

export const YT_BASE = 'https://www.googleapis.com/youtube/v3'

export function assertYoutubeConfigured(): void {
  if (!env.YOUTUBE_API_KEY || !env.YOUTUBE_CHANNEL_ID) {
    throw InternalError(
      'YouTube integration is not configured — set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID in .env',
    )
  }
}

export async function ytFetch<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY! }).toString()
  const response = await fetch(`${YT_BASE}${path}?${qs}`, { signal: AbortSignal.timeout(10_000) })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw InternalError(
      `YouTube API (${path}) returned HTTP ${response.status}: ${body?.error?.message ?? 'unknown error'}`,
    )
  }

  return body as T
}

// The uploads playlist id never changes for a given channel, so it's cached
// for the lifetime of the process instead of re-resolved on every call.
let cachedUploadsPlaylistId: string | null = null

export async function resolveUploadsPlaylistId(): Promise<string> {
  if (cachedUploadsPlaylistId) return cachedUploadsPlaylistId

  const body = await ytFetch<{
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>
  }>('/channels', { part: 'contentDetails', id: env.YOUTUBE_CHANNEL_ID! })

  const uploadsId = body.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsId) {
    throw InternalError(`No channel found for YOUTUBE_CHANNEL_ID (${env.YOUTUBE_CHANNEL_ID})`)
  }

  cachedUploadsPlaylistId = uploadsId
  return uploadsId
}
