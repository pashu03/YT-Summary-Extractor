import type { ApiErrorBody, CaptionTrackInfo } from './types.js';

export type ErrorCode =
  | 'INVALID_URL'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'VIDEO_UNAVAILABLE'
  | 'VIDEO_REMOVED'
  | 'VIDEO_PRIVATE'
  | 'AGE_RESTRICTED'
  | 'LOGIN_REQUIRED'
  | 'REGION_RESTRICTED'
  | 'RESTRICTED'
  | 'LIVE_CONTENT'
  | 'NO_CAPTIONS'
  | 'LANGUAGE_UNAVAILABLE'
  | 'EMPTY_TRANSCRIPT'
  | 'EXTRACTION_FAILED'
  | 'UPSTREAM_BLOCKED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_SCRIPT'
  | 'CANCELLED'
  | 'INTERNAL';

interface ErrorSpec {
  status: number;
  message: string;
}

/** Default HTTP status and user-facing wording for every error the API can return. */
const SPECS: Record<ErrorCode, ErrorSpec> = {
  INVALID_URL: {
    status: 400,
    message: "That doesn't look like a YouTube video link. Paste a full video, youtu.be or Shorts URL.",
  },
  INVALID_REQUEST: { status: 400, message: 'The request was not valid.' },
  NOT_FOUND: { status: 404, message: 'This endpoint does not exist.' },
  VIDEO_UNAVAILABLE: {
    status: 404,
    message: "This video isn't available. It may have been deleted, or the link may be wrong.",
  },
  VIDEO_REMOVED: { status: 404, message: 'This video has been removed from YouTube.' },
  VIDEO_PRIVATE: {
    status: 403,
    message: 'This video is private. Only public and unlisted videos can be processed.',
  },
  AGE_RESTRICTED: {
    status: 403,
    message: "This video is age-restricted and requires signing in to YouTube, so it can't be processed here.",
  },
  LOGIN_REQUIRED: {
    status: 403,
    message: "This video requires signing in to YouTube (for example members-only content), so it can't be processed here.",
  },
  REGION_RESTRICTED: {
    status: 403,
    message: "This video is blocked in the region this service runs from, so its captions can't be retrieved.",
  },
  RESTRICTED: { status: 403, message: "YouTube restricts access to this video, so it can't be processed here." },
  LIVE_CONTENT: {
    status: 422,
    message: 'Live streams and premieres have no finished captions yet. Try again once the recording is published.',
  },
  NO_CAPTIONS: {
    status: 422,
    message: "This video has no captions or subtitles, so there is no transcript to extract.",
  },
  LANGUAGE_UNAVAILABLE: { status: 422, message: 'Captions are not available in the requested language.' },
  EMPTY_TRANSCRIPT: {
    status: 422,
    message: 'The caption track for this video is empty, so there is nothing to transcribe.',
  },
  EXTRACTION_FAILED: {
    status: 502,
    message: 'The captions for this video could not be retrieved. Please try again in a moment.',
  },
  UPSTREAM_BLOCKED: {
    status: 503,
    message: 'YouTube is temporarily refusing requests from this server. Please wait a few minutes and try again.',
  },
  TIMEOUT: { status: 504, message: 'YouTube took too long to respond. Please try again.' },
  NETWORK_ERROR: {
    status: 502,
    message: 'The server could not reach YouTube. Check the network connection and try again.',
  },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please wait a minute and try again.' },
  UNSUPPORTED_SCRIPT: {
    status: 422,
    message: "PDF export doesn't support this transcript's writing system yet. Use the TXT, SRT or VTT download instead.",
  },
  CANCELLED: { status: 499, message: 'The request was cancelled.' },
  INTERNAL: { status: 500, message: 'Something went wrong while processing this video. Please try again.' },
};

interface AppErrorOptions {
  message?: string;
  detail?: string;
  availableLanguages?: CaptionTrackInfo[];
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly availableLanguages?: CaptionTrackInfo[];

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? SPECS[code].message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = SPECS[code].status;
    this.detail = options.detail;
    this.availableLanguages = options.availableLanguages;
  }

  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.availableLanguages ? { availableLanguages: this.availableLanguages } : {}),
    };
  }
}

const UPSTREAM_CODES: ReadonlySet<ErrorCode> = new Set(['UPSTREAM_BLOCKED', 'EXTRACTION_FAILED', 'TIMEOUT', 'NETWORK_ERROR']);

/**
 * Log failures caused by YouTube or the network rather than by the video, so a
 * host-wide block shows up in the platform's logs. Only the error code, YouTube's
 * own reason and the hosting region are logged: never the video link or transcript.
 */
export function logUpstreamFailure(error: AppError, scope: string): void {
  if (!UPSTREAM_CODES.has(error.code)) return;
  const region = process.env.VERCEL_REGION ? ` region=${process.env.VERCEL_REGION}` : '';
  console.warn(`[${scope}] ${error.code}${region}${error.detail ? ` youtube="${error.detail}"` : ''}`);
}

/** Normalise anything thrown into an AppError so callers always get a safe, user-facing message. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError('INTERNAL', { cause: err });
}
