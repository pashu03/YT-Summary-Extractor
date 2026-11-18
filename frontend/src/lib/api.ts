import type { ApiErrorBody, StreamEvent, TranscriptResult } from '@/types/api';

/** Base URL of the Express API. Set NEXT_PUBLIC_API_URL when it is not on localhost:4000. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

/** Give up if the server has not finished within this time. */
const REQUEST_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.body = body;
  }
}

const OFFLINE: ApiErrorBody = {
  code: 'SERVER_UNREACHABLE',
  message: "Can't reach the transcript service. Check your connection and that the API server is running.",
};
const TIMED_OUT: ApiErrorBody = {
  code: 'TIMEOUT',
  message: 'This is taking longer than expected, so the request was stopped. Please try again.',
};
const INTERRUPTED: ApiErrorBody = {
  code: 'CONNECTION_LOST',
  message: 'The connection was interrupted before the transcript was ready. Please try again.',
};

async function readError(response: Response): Promise<ApiErrorBody> {
  try {
    const data = (await response.json()) as { error?: ApiErrorBody };
    if (data.error?.code && data.error.message) return data.error;
  } catch {
    // Not JSON: fall through to a generic message.
  }
  if (response.status === 429) return { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' };
  return { code: 'INTERNAL', message: `The server answered with an unexpected error (HTTP ${response.status}).` };
}

/**
 * Wrap a caller's AbortSignal with a timeout. `timedOut()` tells the two apart
 * afterwards, because both surface as the same AbortError.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

interface TranscriptRequest {
  url: string;
  /** Caption track id or language code; omit for the spoken language. */
  language?: string;
}

/**
 * Request a transcript and summary. The server streams newline-delimited JSON
 * events; each is passed to `onEvent` as it arrives so the UI can show live
 * progress. Resolves with the final result, rejects with an ApiError, and
 * rejects with a DOMException named "AbortError" when the caller cancels.
 */
export async function requestTranscript(
  request: TranscriptRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<TranscriptResult> {
  const timeout = withTimeout(signal, REQUEST_TIMEOUT_MS);
  const failure = (fallback: ApiErrorBody): Error => {
    if (signal?.aborted) return new DOMException('The request was cancelled.', 'AbortError');
    return new ApiError(timeout.timedOut() ? TIMED_OUT : fallback);
  };

  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/api/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(request),
        signal: timeout.signal,
        cache: 'no-store',
      });
    } catch {
      throw failure(OFFLINE);
    }
    if (!response.ok) throw new ApiError(await readError(response));
    if (!response.body) throw new ApiError(INTERRUPTED);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let result: TranscriptResult | null = null;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'error') throw new ApiError(event.error);
      if (event.type === 'result') result = event.result;
      onEvent(event);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let newline = buffered.indexOf('\n');
        while (newline >= 0) {
          handleLine(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf('\n');
        }
      }
      handleLine(buffered + decoder.decode());
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw failure(INTERRUPTED);
    }

    if (!result) throw new ApiError(INTERRUPTED);
    return result;
  } finally {
    timeout.dispose();
  }
}

export interface PdfOptions {
  summary: boolean;
  transcript: boolean;
  timestamps: boolean;
}

/**
 * Ask the server to render a PDF. The result is sent along with the request
 * because the server keeps no copy of anything it has processed.
 */
export async function requestPdf(result: TranscriptResult, include: PdfOptions): Promise<Blob> {
  const timeout = withTimeout(undefined, REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/api/export/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
        signal: timeout.signal,
        cache: 'no-store',
        body: JSON.stringify({
          video: {
            id: result.video.id,
            title: result.video.title,
            author: result.video.author,
            durationSeconds: result.video.durationSeconds,
          },
          language: { name: result.captions.name, isAutoGenerated: result.captions.isAutoGenerated },
          include,
          summary: {
            short: result.summary.short,
            takeaways: result.summary.takeaways,
            sections: result.summary.sections.map(({ title, start, end, points }) => ({ title, start, end, points })),
          },
          keywords: result.keywords.map((keyword) => keyword.term),
          paragraphs: result.transcript.paragraphs.map(({ start, text, sectionIndex }) => ({ start, text, sectionIndex })),
          stats: { wordCount: result.stats.wordCount, readingMinutes: result.stats.readingMinutes },
        }),
      });
    } catch {
      throw new ApiError(timeout.timedOut() ? TIMED_OUT : OFFLINE);
    }
    if (!response.ok) throw new ApiError(await readError(response));
    return await response.blob();
  } finally {
    timeout.dispose();
  }
}
