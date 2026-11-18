const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Subtitle timestamp: "00:01:15,250" for SRT (comma) or "00:01:15.250" for WebVTT (dot). */
export function formatSubtitleTime(totalSeconds: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`;
}

/** 1120 → "18 min 40 s", 45 → "45 s", 7260 → "2 h 1 min". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/** "14.6" minutes → "15 min"; under a minute → "< 1 min". */
export function formatReadingTime(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(minutes)} min`;
}

const full = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** 3357 → "3,357". */
export const formatNumber = (value: number) => full.format(value);

/** 25300837 → "25.3M"; numbers under 10,000 are written in full. */
export const formatCompact = (value: number) => (value < 10_000 ? full.format(value) : compact.format(value));

/** 0.246 → "25%". */
export const formatPercent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** Link to a moment in the video on YouTube. */
export function youtubeTimeUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}
