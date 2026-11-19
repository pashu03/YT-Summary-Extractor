import { AppError } from '../errors.js';
import type { VideoMeta } from '../types.js';
import { request } from './http.js';

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

export interface OEmbedResult {
  /** Video details without the duration, which the transcript provides. */
  meta: Omit<VideoMeta, 'durationSeconds'>;
  /** False when YouTube would not describe the video (private, or embedding switched off). */
  described: boolean;
}

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/** Basic details that need no lookup: used when oEmbed declines to describe a video. */
function fallbackMeta(videoId: string): OEmbedResult['meta'] {
  return {
    id: videoId,
    url: watchUrl(videoId),
    title: 'YouTube video',
    author: 'Unknown channel',
    channelUrl: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: null,
  };
}

function trustedYouTubeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'youtube.com' || host.endsWith('.youtube.com')) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Video title, channel and thumbnail from YouTube's public oEmbed endpoint,
 * the documented way for third-party sites to describe a video. It needs no
 * key. A video that does not exist is reported as unavailable; any other
 * refusal (private video, embedding disabled, service hiccup) falls back to
 * basic details so the transcript service can give the definitive answer.
 */
export async function fetchOEmbed(videoId: string, signal?: AbortSignal): Promise<OEmbedResult> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`;
  let status: number;
  let body: string;
  try {
    ({ status, body } = await request(endpoint, { signal, timeoutMs: 8_000 }));
  } catch (err) {
    if (err instanceof AppError && err.code === 'CANCELLED') throw err;
    return { meta: fallbackMeta(videoId), described: false };
  }

  if (status === 400 || status === 404) throw new AppError('VIDEO_UNAVAILABLE');
  if (status !== 200) return { meta: fallbackMeta(videoId), described: false };

  let data: OEmbedResponse;
  try {
    data = JSON.parse(body) as OEmbedResponse;
  } catch {
    return { meta: fallbackMeta(videoId), described: false };
  }
  const fallback = fallbackMeta(videoId);
  return {
    described: true,
    meta: {
      ...fallback,
      title: data.title?.trim() || fallback.title,
      author: data.author_name?.trim() || fallback.author,
      channelUrl: trustedYouTubeUrl(data.author_url),
      // Thumbnails are always available at this predictable address in a larger size than oEmbed's.
      thumbnailUrl: fallback.thumbnailUrl,
    },
  };
}
