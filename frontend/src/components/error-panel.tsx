'use client';

import {
  Ban,
  CaptionsOff,
  CircleAlert,
  Globe,
  Hourglass,
  Languages,
  Link2,
  Lock,
  Radio,
  RotateCcw,
  ServerCrash,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { ListenButton } from '@/components/speech';
import { joinForSpeech } from '@/lib/speech';
import { Button } from '@/components/ui/button';
import type { ApiErrorBody } from '@/types/api';

interface ErrorCopy {
  icon: LucideIcon;
  title: string;
  /** What the person can do about it. */
  hint?: string;
  /** Whether trying the same link again could plausibly work. */
  retryable: boolean;
}

const COPY: Record<string, ErrorCopy> = {
  INVALID_URL: { icon: Link2, title: "That link doesn't look right", hint: 'Copy the link from the YouTube address bar or the Share button and paste it again.', retryable: false },
  VIDEO_UNAVAILABLE: { icon: Ban, title: 'Video not found', hint: 'Check the link for typos, or open it on YouTube to confirm the video still exists.', retryable: false },
  VIDEO_REMOVED: { icon: Ban, title: 'This video was removed', retryable: false },
  VIDEO_PRIVATE: { icon: Lock, title: 'This video is private', hint: 'Ask the owner to make it public or unlisted, then try again.', retryable: false },
  AGE_RESTRICTED: { icon: Lock, title: 'Age-restricted video', hint: 'Sign-in checks are respected, so age-restricted videos are not supported.', retryable: false },
  LOGIN_REQUIRED: { icon: Lock, title: 'Sign-in required', hint: 'Videos that need a YouTube account, such as members-only content, are not supported.', retryable: false },
  REGION_RESTRICTED: { icon: Globe, title: 'Not available in this region', retryable: false },
  RESTRICTED: { icon: Lock, title: 'Restricted video', retryable: false },
  LIVE_CONTENT: { icon: Radio, title: 'Live stream or premiere', hint: 'Captions become available after the stream ends and YouTube finishes processing it.', retryable: false },
  NO_CAPTIONS: {
    icon: CaptionsOff,
    title: 'No captions available',
    hint: 'The creator has not added subtitles and YouTube has not generated any. Speech-to-text from audio is not enabled on this server.',
    retryable: false,
  },
  EMPTY_TRANSCRIPT: { icon: CaptionsOff, title: 'The captions are empty', hint: 'The caption track exists but contains no speech, for example a music-only video.', retryable: false },
  LANGUAGE_UNAVAILABLE: { icon: Languages, title: 'Language not available', retryable: false },
  EXTRACTION_FAILED: { icon: ServerCrash, title: "Couldn't retrieve the captions", hint: 'This is usually temporary.', retryable: true },
  UPSTREAM_BLOCKED: {
    icon: ServerCrash,
    title: 'YouTube is blocking this server',
    hint: 'YouTube often refuses requests from shared cloud servers. Running the app on your own computer usually works.',
    retryable: true,
  },
  RATE_LIMITED: { icon: Hourglass, title: 'Too many requests', retryable: true },
  TIMEOUT: { icon: Hourglass, title: 'The request timed out', retryable: true },
  NETWORK_ERROR: { icon: WifiOff, title: "Couldn't reach YouTube", retryable: true },
  SERVER_UNREACHABLE: { icon: WifiOff, title: "Can't reach the server", retryable: true },
  CONNECTION_LOST: { icon: WifiOff, title: 'Connection interrupted', retryable: true },
};

const FALLBACK: ErrorCopy = { icon: CircleAlert, title: 'Something went wrong', retryable: true };

interface ErrorPanelProps {
  error: ApiErrorBody;
  onRetry: () => void;
  onReset: () => void;
  onChooseLanguage: (trackId: string) => void;
}

export function ErrorPanel({ error, onRetry, onReset, onChooseLanguage }: ErrorPanelProps) {
  const copy = COPY[error.code] ?? FALLBACK;
  const Icon = copy.icon;
  // YouTube's own wording is worth showing when it adds to our message.
  const detail = error.detail && !error.message.includes(error.detail) ? error.detail : null;

  return (
    <div role="alert" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-destructive/25 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">{copy.title}</h2>
            <ListenButton id="error" label="this message" text={joinForSpeech([copy.title, error.message, copy.hint])} />
          </div>
          <p className="mt-1 text-sm text-foreground/80">{error.message}</p>
          {copy.hint && <p className="mt-1 text-sm text-muted-foreground">{copy.hint}</p>}
          {detail && (
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">YouTube says:</span> {detail}
            </p>
          )}

          {error.availableLanguages && error.availableLanguages.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">Available captions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {error.availableLanguages.map((track) => (
                  <Button key={track.id} type="button" variant="outline" size="sm" onClick={() => onChooseLanguage(track.id)}>
                    {track.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {copy.retryable && (
              <Button type="button" size="sm" onClick={onRetry}>
                <RotateCcw /> Try again
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              Use a different link
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
