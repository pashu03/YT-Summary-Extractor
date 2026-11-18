import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError, toAppError } from '../errors.js';
import { runPipeline } from '../pipeline.js';
import type { StreamEvent } from '../types.js';
import { parseYouTubeUrl } from '../youtube/url.js';

const bodySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  language: z.string().trim().min(1).max(40).optional(),
});

const wantsStream = (req: Request) =>
  req.query.stream === '1' || (req.get('accept') ?? '').includes('application/x-ndjson');

export const transcriptRouter = Router();

/**
 * POST /api/transcript  { url, language? }
 *
 * Default: responds with the finished result as JSON, using HTTP status codes
 * for errors. With `Accept: application/x-ndjson` (or `?stream=1`) it streams
 * newline-delimited JSON events instead — progress, video details, then the
 * result or an error — so the UI can show real progress.
 */
transcriptRouter.post('/', async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('INVALID_URL', { detail: 'Send a JSON body such as { "url": "https://youtu.be/…" }.' });
  }
  // Reject bad links before any streaming starts, so they get a plain 400.
  parseYouTubeUrl(parsed.data.url);

  // Stop work on YouTube's side of things as soon as the browser gives up.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  if (!wantsStream(req)) {
    const result = await runPipeline(parsed.data, { signal: abort.signal });
    res.json(result);
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no'); // ask reverse proxies not to buffer the stream
  const send = (event: StreamEvent) => {
    if (res.writableEnded || abort.signal.aborted) return;
    res.write(`${JSON.stringify(event)}\n`);
    // `compression` buffers output; flush so each event reaches the browser immediately.
    (res as Response & { flush?: () => void }).flush?.();
  };

  try {
    const result = await runPipeline(parsed.data, { emit: send, signal: abort.signal });
    send({ type: 'result', result });
  } catch (err) {
    const error = toAppError(err);
    if (error.code === 'INTERNAL') console.error('[transcript] unexpected failure:', err);
    if (error.code !== 'CANCELLED') send({ type: 'error', error: error.toBody() });
  } finally {
    res.end();
  }
});
