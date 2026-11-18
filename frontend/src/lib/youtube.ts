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

const ID_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v', 'e', 'watch']);

export type UrlCheck = { ok: true; videoId: string } | { ok: false; message: string };

/**
 * Check a link in the browser so obvious mistakes get instant feedback. The
 * server runs the same checks again; this copy only exists to save a round trip.
 */
export function checkYouTubeUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, message: 'Paste a YouTube link to get started.' };
  if (VIDEO_ID.test(raw)) return { ok: true, videoId: raw };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, message: "That doesn't look like a link. Paste the full YouTube URL." };
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    return segments[0] && VIDEO_ID.test(segments[0])
      ? { ok: true, videoId: segments[0] }
      : { ok: false, message: 'This youtu.be link is missing its video id.' };
  }
  if (!YOUTUBE_HOSTS.has(host)) {
    return { ok: false, message: 'Only YouTube links are supported — youtube.com, youtu.be or Shorts.' };
  }

  const queryId = url.searchParams.get('v');
  if (queryId) {
    return VIDEO_ID.test(queryId)
      ? { ok: true, videoId: queryId }
      : { ok: false, message: "The video id in this link isn't valid. Copy the link again from YouTube." };
  }

  const [first, second] = segments;
  if (first && second && ID_PATH_PREFIXES.has(first.toLowerCase()) && VIDEO_ID.test(second)) {
    return { ok: true, videoId: second };
  }
  if (first === 'playlist' || url.searchParams.has('list')) {
    return { ok: false, message: 'This is a playlist link. Paste the link to a single video instead.' };
  }
  if (first && (first.startsWith('@') || ['channel', 'c', 'user'].includes(first))) {
    return { ok: false, message: 'This is a channel link. Paste the link to a single video instead.' };
  }
  return { ok: false, message: "This link doesn't point to a YouTube video." };
}
