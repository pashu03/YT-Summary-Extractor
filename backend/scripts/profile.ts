/**
 * Time each stage of the pipeline for one video.
 *
 *   npx tsx scripts/profile.ts <video-id>
 */
import { analyseTranscript } from '../src/nlp/analyze.js';
import { fetchCaptionCues, listCaptionTracks, selectCaptionTrack } from '../src/youtube/captions.js';
import { fetchPlayer } from '../src/youtube/innertube.js';
import { buildVideoMeta, parseChapters } from '../src/youtube/metadata.js';

const videoId = process.argv[2] ?? 'aircAruvnKk';
const timed = async <T>(label: string, work: () => T | Promise<T>): Promise<T> => {
  const started = performance.now();
  const value = await work();
  console.log(`${label.padEnd(28)} ${(performance.now() - started).toFixed(0)} ms`);
  return value;
};

const { player, userAgent } = await timed('player request', () => fetchPlayer(videoId));
const video = buildVideoMeta(videoId, player);
const track = selectCaptionTrack(listCaptionTracks(player), player);
const cues = await timed('caption download + parse', () => fetchCaptionCues(track, userAgent));
const input = {
  cues,
  languageCode: track.languageCode,
  title: video.title,
  durationSeconds: video.durationSeconds,
  chapters: parseChapters(player.videoDetails?.shortDescription, video.durationSeconds),
};
await timed('analysis (first run)', () => analyseTranscript(input));
const analysis = await timed('analysis (warm)', () => analyseTranscript(input));
console.log(`${video.title} — ${analysis.stats.wordCount} words, ${analysis.stats.sentenceCount} sentences, ${cues.length} cues`);
