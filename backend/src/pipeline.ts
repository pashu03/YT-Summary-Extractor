import { AppError } from './errors.js';
import { analyseTranscript } from './nlp/analyze.js';
import type { Stage, StreamEvent, TranscriptResult } from './types.js';
import { fetchCaptionCues, listCaptionTracks, selectCaptionTrack, toTrackInfo } from './youtube/captions.js';
import { fetchPlayer } from './youtube/innertube.js';
import { buildVideoMeta, parseChapters } from './youtube/metadata.js';
import { parseYouTubeUrl } from './youtube/url.js';

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
  const { player, userAgent } = await fetchPlayer(videoId, signal);
  const video = buildVideoMeta(videoId, player);
  const tracks = listCaptionTracks(player);
  emit?.({ type: 'video', video, available: tracks.map(toTrackInfo) });

  progress('captions', 35, 'Retrieving captions');
  const track = selectCaptionTrack(tracks, player, input.language);
  const rawCues = await fetchCaptionCues(track, userAgent, signal);
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
    chapters: parseChapters(player.videoDetails?.shortDescription, video.durationSeconds),
  });
  checkCancelled();

  progress('summary', 92, 'Writing the summary');
  await yieldToEventLoop();

  const result: TranscriptResult = {
    video,
    captions: { ...toTrackInfo(track), available: tracks.map(toTrackInfo) },
    transcript: { cues: analysis.cues, paragraphs: analysis.paragraphs },
    summary: analysis.summary,
    keywords: analysis.keywords,
    stats: { ...analysis.stats, processingMs: Math.round(performance.now() - startedAt) },
  };
  progress('done', 100, 'Done');
  return result;
}
