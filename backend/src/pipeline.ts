import { config } from './config.js';
import { AppError } from './errors.js';
import { analyseTranscript } from './nlp/analyze.js';
import type { CaptionTrackInfo, Stage, StreamEvent, TranscriptResult, VideoMeta } from './types.js';
import {
  fetchCaptionCues,
  listCaptionTracks,
  selectCaptionTrack,
  toTrackInfo,
  type RawCue,
} from './youtube/captions.js';
import { fetchPlayer } from './youtube/innertube.js';
import { buildVideoMeta, parseChapters, type Chapter } from './youtube/metadata.js';
import { fetchOEmbed } from './youtube/oembed.js';
import { fetchServiceTranscript, isServiceConfigured } from './youtube/supadata.js';
import { parseYouTubeUrl } from './youtube/url.js';

interface LoadedCaptions {
  video: VideoMeta;
  track: CaptionTrackInfo;
  available: CaptionTrackInfo[];
  cues: RawCue[];
  chapters: Chapter[];
}

interface LoadContext {
  progress: (stage: Stage, percent: number, message: string) => void;
  emit?: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/** Captions straight from YouTube: free, but YouTube often refuses cloud servers. */
async function loadFromYouTube(videoId: string, language: string | undefined, ctx: LoadContext): Promise<LoadedCaptions> {
  const { player, userAgent } = await fetchPlayer(videoId, ctx.signal);
  const video = buildVideoMeta(videoId, player);
  const tracks = listCaptionTracks(player);
  ctx.emit?.({ type: 'video', video, available: tracks.map(toTrackInfo) });

  ctx.progress('captions', 35, 'Retrieving captions');
  const track = selectCaptionTrack(tracks, player, language);
  const cues = await fetchCaptionCues(track, userAgent, ctx.signal);
  return {
    video,
    track: toTrackInfo(track),
    available: tracks.map(toTrackInfo),
    cues,
    chapters: parseChapters(player.videoDetails?.shortDescription, video.durationSeconds),
  };
}

/** Captions through the transcript service, with video details from YouTube's public oEmbed endpoint. */
async function loadFromService(videoId: string, language: string | undefined, ctx: LoadContext): Promise<LoadedCaptions> {
  const { meta } = await fetchOEmbed(videoId, ctx.signal);

  ctx.progress('captions', 35, 'Retrieving captions');
  const { track, available, cues } = await fetchServiceTranscript(videoId, language, ctx.signal);
  const durationSeconds = Math.ceil(cues.reduce((end, cue) => Math.max(end, cue.start + cue.duration), 0));
  const video: VideoMeta = { ...meta, durationSeconds };
  ctx.emit?.({ type: 'video', video, available });
  return { video, track, available, cues, chapters: [] };
}

/** Pick the caption source according to TRANSCRIPT_PROVIDER (see config.ts). */
async function loadCaptions(videoId: string, language: string | undefined, ctx: LoadContext): Promise<LoadedCaptions> {
  if (config.transcriptProvider === 'supadata') return loadFromService(videoId, language, ctx);
  try {
    return await loadFromYouTube(videoId, language, ctx);
  } catch (err) {
    const blocked = err instanceof AppError && err.code === 'UPSTREAM_BLOCKED';
    if (!blocked || config.transcriptProvider !== 'auto' || !isServiceConfigured()) throw err;
    console.warn('[pipeline] YouTube refused this server; using the transcript service instead');
    return loadFromService(videoId, language, ctx);
  }
}

export interface PipelineInput {
  url: string;
  /** Caption track id or language code. Omit to transcribe the spoken language. */
  language?: string;
}

interface PipelineOptions {
  /** Receives progress as the work advances; used by the streaming endpoint. */
  emit?: (event: StreamEvent) => void;
  /** Aborts outstanding YouTube requests when the caller goes away. */
  signal?: AbortSignal;
}

/** Let pending I/O (such as flushing a progress event) run before CPU-bound work starts. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Run one request end to end. All state lives in local variables for the
 * duration of the call: nothing is cached, written to disk, or kept once the
 * result has been returned.
 */
export async function runPipeline(input: PipelineInput, options: PipelineOptions = {}): Promise<TranscriptResult> {
  const { emit, signal } = options;
  const startedAt = performance.now();
  const progress = (stage: Stage, percent: number, message: string) => emit?.({ type: 'progress', stage, percent, message });
  const checkCancelled = () => {
    if (signal?.aborted) throw new AppError('CANCELLED');
  };

  progress('validate', 5, 'Checking the link');
  const { videoId } = parseYouTubeUrl(input.url);

  progress('metadata', 15, 'Fetching video details');
  const { video, track, available, cues: rawCues, chapters } = await loadCaptions(videoId, input.language, {
    progress,
    emit,
    signal,
  });
  checkCancelled();

  progress('transcript', 60, 'Building the timestamped transcript');
  await yieldToEventLoop();
  progress('analysis', 75, 'Ranking sentences and extracting keywords');
  await yieldToEventLoop();

  const analysis = analyseTranscript({
    cues: rawCues,
    languageCode: track.languageCode,
    title: video.title,
    durationSeconds: video.durationSeconds,
    chapters,
  });
  checkCancelled();

  progress('summary', 92, 'Writing the summary');
  await yieldToEventLoop();

  const result: TranscriptResult = {
    video,
    captions: { ...track, available },
    transcript: { cues: analysis.cues, paragraphs: analysis.paragraphs },
    summary: analysis.summary,
    keywords: analysis.keywords,
    stats: { ...analysis.stats, processingMs: Math.round(performance.now() - startedAt) },
  };
  progress('done', 100, 'Done');
  return result;
}
