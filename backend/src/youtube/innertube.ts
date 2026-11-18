import { AppError } from '../errors.js';
import { request } from './http.js';

/**
 * Minimal client for YouTube's InnerTube `player` endpoint — the same public
 * endpoint the official apps call. Requests are anonymous: no cookies, no
 * sign-in and no attempt to get around age, privacy or region restrictions.
 * When YouTube says a video needs sign-in, that is reported to the user as-is.
 */

const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

interface ClientProfile {
  name: string;
  /** Value of the X-Youtube-Client-Name header. */
  id: string;
  version: string;
  userAgent: string;
  context: Record<string, unknown>;
}

const ANDROID_VERSION = process.env.YT_ANDROID_CLIENT_VERSION || '20.10.38';
const IOS_VERSION = process.env.YT_IOS_CLIENT_VERSION || '20.10.4';

/** Tried in order; later profiles are only used when an earlier one gives an inconclusive answer. */
const CLIENTS: ClientProfile[] = [
  {
    name: 'ANDROID',
    id: '3',
    version: ANDROID_VERSION,
    userAgent: `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14) gzip`,
    context: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION, androidSdkVersion: 34, hl: 'en', gl: 'US' },
  },
  {
    name: 'IOS',
    id: '5',
    version: IOS_VERSION,
    userAgent: `com.google.ios.youtube/${IOS_VERSION} (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)`,
    context: {
      clientName: 'IOS',
      clientVersion: IOS_VERSION,
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      hl: 'en',
      gl: 'US',
    },
  },
];

interface TextRuns {
  simpleText?: string;
  runs?: { text?: string }[];
}

export interface RawCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  vssId?: string;
  name?: TextRuns;
}

export interface PlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
    messages?: string[];
    desktopLegacyAgeGateReason?: number;
    errorScreen?: { playerErrorMessageRenderer?: { reason?: TextRuns; subreason?: TextRuns } };
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    author?: string;
    channelId?: string;
    shortDescription?: string;
    viewCount?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
    isUpcoming?: boolean;
    thumbnail?: { thumbnails?: { url?: string; width?: number; height?: number }[] };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: RawCaptionTrack[];
      /** One entry per audio track; dubbed videos have several. `audioTrackId` looks like "en-US.4". */
      audioTracks?: { defaultCaptionTrackIndex?: number; audioTrackId?: string }[];
      defaultAudioTrackIndex?: number;
    };
  };
}

export interface PlayerResult {
  player: PlayerResponse;
  /** User agent of the client profile that produced the response; reused for caption downloads. */
  userAgent: string;
}

export function readText(value: TextRuns | undefined): string {
  if (!value) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  return (value.runs ?? []).map((run) => run.text ?? '').join('');
}

function hasCaptionTracks(player: PlayerResponse): boolean {
  return (player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0) > 0;
}

/**
 * Translate YouTube's playability status into one of our errors, or null when
 * the video is playable. `inconclusive` marks answers that describe the
 * request rather than the video, where another client profile may do better.
 */
export function classifyPlayability(player: PlayerResponse): { error: AppError; inconclusive: boolean } | null {
  const playability = player.playabilityStatus;
  const details = player.videoDetails;
  const status = playability?.status ?? '';

  if (status === 'OK') {
    if (details?.isLive || details?.isUpcoming) return { error: new AppError('LIVE_CONTENT'), inconclusive: false };
    return null;
  }

  const reason = (playability?.reason || readText(playability?.errorScreen?.playerErrorMessageRenderer?.reason)).trim();
  const subreason = readText(playability?.errorScreen?.playerErrorMessageRenderer?.subreason).trim();
  const detail = [reason, subreason].filter(Boolean).join(' ') || undefined;
  const text = `${reason} ${subreason} ${(playability?.messages ?? []).join(' ')}`.toLowerCase();
  const definite = (error: AppError) => ({ error, inconclusive: false });

  if (!playability) {
    return { error: new AppError('EXTRACTION_FAILED', { detail: 'YouTube returned an unexpected response.' }), inconclusive: true };
  }
  if (/not a bot|unusual traffic|automated/.test(text)) {
    return { error: new AppError('UPSTREAM_BLOCKED', { detail }), inconclusive: true };
  }
  if (/needs to be reloaded|try again later|playback on other websites/.test(text)) {
    return { error: new AppError('EXTRACTION_FAILED', { detail }), inconclusive: true };
  }
  if (/\bprivate\b/.test(text)) return definite(new AppError('VIDEO_PRIVATE', { detail }));
  if (
    playability.desktopLegacyAgeGateReason !== undefined ||
    status === 'AGE_CHECK_REQUIRED' ||
    status === 'AGE_VERIFICATION_REQUIRED' ||
    /inappropriate for some users|confirm your age|age-restricted|age restricted/.test(text)
  ) {
    return definite(new AppError('AGE_RESTRICTED', { detail }));
  }
  if (/members-only|members only|join this channel|membership/.test(text)) {
    return definite(new AppError('LOGIN_REQUIRED', { detail }));
  }
  if (/in your country|your country|not available in your region|geographic/.test(text)) {
    return definite(new AppError('REGION_RESTRICTED', { detail }));
  }
  if (status === 'LIVE_STREAM_OFFLINE' || /live stream|live event|premiere|live recording/.test(text)) {
    return definite(new AppError('LIVE_CONTENT', { detail }));
  }
  if (/removed|terminated|deleted|no longer available|copyright|closed/.test(text)) {
    return definite(new AppError('VIDEO_REMOVED', { detail }));
  }
  if (/requires payment|purchase|rental|rent |premium/.test(text)) {
    return definite(new AppError('RESTRICTED', { detail }));
  }
  if (status === 'ERROR' || /unavailable|does not exist|isn't available/.test(text)) {
    return definite(new AppError('VIDEO_UNAVAILABLE', { detail }));
  }
  if (status === 'LOGIN_REQUIRED') return definite(new AppError('LOGIN_REQUIRED', { detail }));
  if (status === 'UNPLAYABLE' || status === 'CONTENT_CHECK_REQUIRED') {
    return definite(new AppError('RESTRICTED', { detail }));
  }
  return { error: new AppError('EXTRACTION_FAILED', { detail }), inconclusive: true };
}

async function callPlayer(client: ClientProfile, videoId: string, signal?: AbortSignal): Promise<PlayerResponse> {
  const { status, body } = await request(PLAYER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': client.userAgent,
      'X-Youtube-Client-Name': client.id,
      'X-Youtube-Client-Version': client.version,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify({ context: { client: client.context }, videoId }),
    signal,
  });

  if (status === 429 || status === 403) {
    throw new AppError('UPSTREAM_BLOCKED', { detail: `YouTube answered with HTTP ${status}.` });
  }
  if (status >= 500) throw new AppError('EXTRACTION_FAILED', { detail: `YouTube answered with HTTP ${status}.` });

  try {
    return JSON.parse(body) as PlayerResponse;
  } catch (cause) {
    throw new AppError('EXTRACTION_FAILED', { detail: 'YouTube returned a response that could not be read.', cause });
  }
}

/**
 * Fetch the player response for a video. A definite answer about the video
 * (private, removed, age-restricted…) is thrown immediately. Inconclusive
 * answers, and playable responses that list no captions, fall through to the
 * next client profile before giving up.
 */
export async function fetchPlayer(videoId: string, signal?: AbortSignal): Promise<PlayerResult> {
  let playableWithoutCaptions: PlayerResult | null = null;
  let lastError: AppError | null = null;

  for (const client of CLIENTS) {
    let player: PlayerResponse;
    try {
      player = await callPlayer(client, videoId, signal);
    } catch (err) {
      // Cancellation and connectivity problems will not improve with another profile.
      if (!(err instanceof AppError) || ['CANCELLED', 'TIMEOUT', 'NETWORK_ERROR'].includes(err.code)) throw err;
      lastError = err;
      continue;
    }

    const problem = classifyPlayability(player);
    if (!problem) {
      const result = { player, userAgent: client.userAgent };
      if (hasCaptionTracks(player)) return result;
      playableWithoutCaptions ??= result;
      continue;
    }
    if (!problem.inconclusive) throw problem.error;
    lastError = problem.error;
  }

  if (playableWithoutCaptions) return playableWithoutCaptions;
  throw lastError ?? new AppError('EXTRACTION_FAILED');
}
