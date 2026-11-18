import { AppError } from '../errors.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'gaming.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Path prefixes whose next segment is the video id: /shorts/ID, /embed/ID, /live/ID, /v/ID. */
const ID_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v', 'e', 'watch']);

export interface ParsedVideoUrl {
  videoId: string;
  /** Canonical watch URL for the video. */
  url: string;
}

function invalid(detail: string): AppError {
  return new AppError('INVALID_URL', { detail });
}

/**
 * Extract the video id from any supported YouTube link: standard watch URLs,
 * youtu.be short links, Shorts, embeds and live URLs. A bare 11-character id
 * is accepted too. Throws INVALID_URL for anything else.
 */
export function parseYouTubeUrl(input: unknown): ParsedVideoUrl {
  if (typeof input !== 'string') throw invalid('No URL was provided.');
  const raw = input.trim();
  if (!raw) throw invalid('No URL was provided.');
  if (raw.length > 2048) throw invalid('The URL is too long.');

  if (VIDEO_ID.test(raw)) return build(raw);

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw invalid('The text is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw invalid('Only http and https links are supported.');
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    const id = segments[0];
    if (id && VIDEO_ID.test(id)) return build(id);
    throw invalid('The youtu.be link does not contain a video id.');
  }

  if (!YOUTUBE_HOSTS.has(host)) throw invalid('The link is not a YouTube URL.');

  const queryId = parsed.searchParams.get('v');
  if (queryId) {
    if (VIDEO_ID.test(queryId)) return build(queryId);
    throw invalid('The video id in the link is not valid.');
  }

  const [first, second] = segments;
  if (first && second && ID_PATH_PREFIXES.has(first.toLowerCase()) && VIDEO_ID.test(second)) {
    return build(second);
  }

  if (first === 'playlist' || parsed.searchParams.has('list')) {
    throw invalid('This is a playlist link. Paste the link to a single video instead.');
  }
  if (first && (first.startsWith('@') || ['channel', 'c', 'user'].includes(first))) {
    throw invalid('This is a channel link. Paste the link to a single video instead.');
  }
  throw invalid('The link does not point to a YouTube video.');
}

function build(videoId: string): ParsedVideoUrl {
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}
