'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiError, requestTranscript } from '@/lib/api';
import type { ApiErrorBody, CaptionTrackInfo, Stage, StreamEvent, TranscriptResult, VideoMeta } from '@/types/api';

export interface Progress {
  stage: Stage;
  percent: number;
  message: string;
}

export interface TranscriptState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** The link being processed, kept so a failed request can be retried. */
  url: string;
  language?: string;
  progress: Progress;
  /** Arrives before the transcript, so the video preview can show early. */
  video: VideoMeta | null;
  available: CaptionTrackInfo[];
  result: TranscriptResult | null;
  error: ApiErrorBody | null;
}

const START: Progress = { stage: 'validate', percent: 2, message: 'Starting' };

const initialState: TranscriptState = {
  status: 'idle',
  url: '',
  progress: START,
  video: null,
  available: [],
  result: null,
  error: null,
};

type Action =
  | { type: 'start'; url: string; language?: string; keepVideo: boolean }
  | { type: 'event'; event: StreamEvent }
  | { type: 'success'; result: TranscriptResult }
  | { type: 'failure'; error: ApiErrorBody }
  | { type: 'reset' };

function reducer(state: TranscriptState, action: Action): TranscriptState {
  switch (action.type) {
    case 'start':
      return {
        ...initialState,
        status: 'loading',
        url: action.url,
        language: action.language,
        // Switching caption language keeps the video preview in place while the new track loads.
        video: action.keepVideo ? state.video : null,
        available: action.keepVideo ? state.available : [],
      };
    case 'event':
      if (state.status !== 'loading') return state;
      if (action.event.type === 'progress') {
        const { stage, percent, message } = action.event;
        return { ...state, progress: { stage, percent, message } };
      }
      if (action.event.type === 'video') {
        return { ...state, video: action.event.video, available: action.event.available };
      }
      return state;
    case 'success':
      return {
        ...state,
        status: 'success',
        result: action.result,
        video: action.result.video,
        available: action.result.captions.available,
        progress: { stage: 'done', percent: 100, message: 'Done' },
        error: null,
      };
    case 'failure':
      return { ...state, status: 'error', error: action.error, result: null };
    case 'reset':
      return initialState;
  }
}

/**
 * Owns one transcript request at a time. Everything lives in component state:
 * nothing is written to local storage, cookies or the URL, so closing or
 * reloading the tab discards it.
 */
export function useTranscript() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (url: string, language: string | undefined, keepVideo: boolean) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    dispatch({ type: 'start', url, language, keepVideo });

    try {
      const result = await requestTranscript(
        { url, language },
        (event) => {
          if (!current.signal.aborted) dispatch({ type: 'event', event });
        },
        current.signal,
      );
      if (!current.signal.aborted) dispatch({ type: 'success', result });
    } catch (err) {
      // A cancelled request has already been replaced or reset; it must not overwrite newer state.
      if (current.signal.aborted) return;
      const error: ApiErrorBody =
        err instanceof ApiError ? err.body : { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
      dispatch({ type: 'failure', error });
    }
  }, []);

  const submit = useCallback((url: string) => run(url, undefined, false), [run]);

  const changeLanguage = useCallback(
    (trackId: string) => {
      if (state.url) void run(state.url, trackId, true);
    },
    [run, state.url],
  );

  const retry = useCallback(() => {
    if (state.url) void run(state.url, state.language, false);
  }, [run, state.url, state.language]);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'reset' });
  }, []);

  // Stop any request still in flight when the page goes away.
  useEffect(() => () => controller.current?.abort(), []);

  return { state, submit, changeLanguage, retry, cancel: reset, reset };
}
