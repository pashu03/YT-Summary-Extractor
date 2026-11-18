'use client';

import { DatabaseZap, ShieldCheck, UserX, Zap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ErrorPanel } from '@/components/error-panel';
import { ListenButton, useSpeech } from '@/components/speech';
import { ResultsSkeleton } from '@/components/text-skeleton';
import { ProgressPanel } from '@/components/progress-panel';
import { ResultsDashboard } from '@/components/results/results-dashboard';
import { UrlForm } from '@/components/url-form';
import { VideoCard } from '@/components/video-card';
import { useTranscript } from '@/hooks/use-transcript';
import { cn } from '@/lib/utils';

const PROMISES = [
  { icon: UserX, label: 'No sign-up' },
  { icon: DatabaseZap, label: 'Nothing stored' },
  { icon: ShieldCheck, label: 'No AI services' },
  { icon: Zap, label: 'Results in seconds' },
];

/** The interactive part of the page: the link form and everything it produces. */
export function TranscriptApp() {
  const transcript = useTranscript();
  const { state } = transcript;
  const { stop: stopSpeech } = useSpeech();
  // Whatever is being read aloud belongs to the content on screen; stop it before that content is replaced.
  const quietly = <Args extends unknown[]>(action: (...args: Args) => void) => (...args: Args) => {
    stopSpeech();
    action(...args);
  };
  const submit = quietly(transcript.submit);
  const changeLanguage = quietly(transcript.changeLanguage);
  const retry = quietly(transcript.retry);
  const cancel = quietly(transcript.cancel);
  const reset = quietly(transcript.reset);
  const top = useRef<HTMLElement>(null);
  const idle = state.status === 'idle';
  const loading = state.status === 'loading';

  // When a request starts, show the form (with its Cancel button) and the progress below it together.
  useEffect(() => {
    if (loading) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading]);

  return (
    <>
      <section ref={top} className="relative scroll-mt-14 overflow-hidden border-b border-border bg-linear-to-b from-secondary via-white to-white">
        <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <div className={cn('relative mx-auto w-full max-w-3xl px-4 text-center sm:px-6', idle ? 'pt-14 pb-12 sm:pt-20 sm:pb-16' : 'pt-6 pb-2')}>
          {idle && (
            <>
              <p className="mx-auto inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-primary shadow-xs ring-1 ring-border">
                <span className="size-1.5 rounded-full bg-chart-1" aria-hidden />
                Free YouTube transcript and summary tool
              </p>
              <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight text-balance text-primary sm:text-5xl">
                Turn any YouTube video into a transcript and summary
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
                Paste a link to get the full timestamped transcript, a structured summary, key topics and keywords — ready to copy or download.
              </p>
              <div className="mt-3 flex justify-center">
                <ListenButton
                  id="intro"
                  label="the introduction"
                  labelled
                  variant="outline"
                  className="bg-white"
                  text="Turn any YouTube video into a transcript and summary. Paste a link to get the full timestamped transcript, a structured summary, key topics and keywords, ready to copy or download. Paste your link in the box below, then press Generate Transcript. No sign-up is needed, and nothing is stored."
                />
              </div>
            </>
          )}

          <div className={cn(idle && 'mt-8')}>
            <UrlForm loading={loading} showExamples={idle} onSubmit={submit} onCancel={cancel} />
          </div>

          {idle && (
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {PROMISES.map(({ icon: Icon, label }) => (
                <li key={label} className="inline-flex items-center gap-1.5">
                  <Icon className="size-4 text-chart-1" aria-hidden /> {label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {!idle && (
        <div className="bg-muted/60">
          <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
            {state.video && (
              <VideoCard
                // A new video gets a fresh card, so an embedded player never carries over.
                key={state.video.id}
                video={state.video}
                available={state.available}
                activeTrack={state.result?.captions ?? state.available.find((track) => track.id === state.language)}
                busy={loading}
                onChangeLanguage={changeLanguage}
              />
            )}
            {loading && <ProgressPanel progress={state.progress} />}
            {/* An outline of the results to come, so the page does not look empty while working. */}
            {loading && <ResultsSkeleton />}
            {state.status === 'error' && state.error && (
              <ErrorPanel error={state.error} onRetry={retry} onReset={reset} onChooseLanguage={changeLanguage} />
            )}
            {state.status === 'success' && state.result && (
              // Remount per transcript so tab, search and layout choices start fresh.
              <ResultsDashboard key={`${state.result.video.id}:${state.result.captions.id}`} result={state.result} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
