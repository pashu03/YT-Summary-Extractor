import type { VideoMeta } from '../types.js';
import type { PlayerResponse } from './innertube.js';

export interface Chapter {
  start: number;
  title: string;
}

export function buildVideoMeta(videoId: string, player: PlayerResponse): VideoMeta {
  const details = player.videoDetails ?? {};
  const thumbnails = (details.thumbnail?.thumbnails ?? []).filter((t) => typeof t.url === 'string');
  const largest = thumbnails.reduce<(typeof thumbnails)[number] | null>(
    (best, t) => (!best || (t.width ?? 0) > (best.width ?? 0) ? t : best),
    null,
  );
  const duration = Number(details.lengthSeconds);
  const views = Number(details.viewCount);

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: (details.title ?? '').trim() || 'Untitled video',
    author: (details.author ?? '').trim() || 'Unknown channel',
    channelUrl: details.channelId ? `https://www.youtube.com/channel/${details.channelId}` : null,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
    thumbnailUrl: largest?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: Number.isFinite(views) && details.viewCount !== undefined ? views : null,
  };
}

const TIMESTAMP = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})`;
/** "0:00 Intro", "[1:23] - Setup", "• 12:05 | Results" */
const LEADING = new RegExp(String.raw`^[\s\-–—•*·▶►➤✅]*[\[(]?${TIMESTAMP}[\])]?\s*[-–—:|.]*\s*(.+)$`);
/** "Intro - 0:00", "Setup (1:23)" */
const TRAILING = new RegExp(String.raw`^(.+?)\s*[-–—:|]*\s*[\[(]?${TIMESTAMP}[\])]?\s*$`);

const toSeconds = (h: string | undefined, m: string, s: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);

/**
 * Read creator-defined chapters from a video description. Mirrors YouTube's
 * own rule of thumb: at least three timestamps in ascending order. Returns an
 * empty list when the description has no usable chapter list.
 */
export function parseChapters(description: string | undefined, durationSeconds: number): Chapter[] {
  if (!description) return [];

  const found: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 160) continue;

    let start: number | null = null;
    let title = '';
    const leading = LEADING.exec(trimmed);
    if (leading) {
      start = toSeconds(leading[1], leading[2], leading[3]);
      title = leading[4];
    } else {
      const trailing = TRAILING.exec(trimmed);
      if (trailing) {
        start = toSeconds(trailing[2], trailing[3], trailing[4]);
        title = trailing[1];
      }
    }
    if (start === null) continue;

    title = title.replace(/^[\s\-–—:|.]+|[\s\-–—:|]+$/g, '').trim();
    // A line that is only timestamps or links is not a chapter heading.
    if (!title || /^https?:\/\//i.test(title) || !/\p{L}/u.test(title)) continue;
    found.push({ start, title: title.slice(0, 90) });
  }

  // A chapter list is a run of consecutive lines with ascending times. Keep the
  // longest run so a stray timestamp elsewhere in the description is ignored.
  const runs: Chapter[][] = [];
  for (const chapter of found) {
    const run = runs[runs.length - 1];
    if (run && chapter.start > run[run.length - 1].start) run.push(chapter);
    else runs.push([chapter]);
  }
  const chapters = runs.reduce<Chapter[]>((best, run) => (run.length > best.length ? run : best), []);
  const withinVideo = durationSeconds > 0 ? chapters.filter((c) => c.start < durationSeconds) : chapters;
  if (withinVideo.length < 3) return [];

  if (withinVideo[0].start > 0) {
    if (withinVideo[0].start <= 15) withinVideo[0] = { ...withinVideo[0], start: 0 };
    else withinVideo.unshift({ start: 0, title: 'Introduction' });
  }
  return withinVideo;
}
