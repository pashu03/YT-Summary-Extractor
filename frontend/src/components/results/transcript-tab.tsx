'use client';

import { AlignLeft, Rows3, Search, X } from 'lucide-react';
import { Fragment, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { DownloadMenu } from '@/components/download-menu';
import { ListenButton } from '@/components/speech';
import { TextSkeleton } from '@/components/text-skeleton';
import { Timestamp } from '@/components/timestamp';
import { Switch } from '@/components/ui/switch';
import { toCueText } from '@/lib/exporters';
import { formatClock, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { withTranslatedSummary } from '@/lib/translate';
import type { TranscriptResult } from '@/types/api';
import { LanguageToggle, type ResultTranslation, type TranslationPart } from './translation';

type View = 'paragraphs' | 'captions';

interface Row {
  key: string;
  start: number;
  text: string;
  /** Section heading to print above this row, when it opens a new section. */
  heading?: string;
}

/** Everything on this tab that follows the language switch: section headings, paragraphs and caption lines. */
const PARTS: TranslationPart[] = ['summary', 'paragraphs', 'cues'];

/** Rows are added in batches as the reader scrolls, so multi-hour transcripts stay responsive. */
const BATCH = 250;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>;
  // split() with a capturing group keeps the matches at the odd indexes.
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="transcript-mark">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function TranscriptTab({ result: original, translation }: { result: TranscriptResult; translation: ResultTranslation }) {
  const summaryTexts = translation.get('summary');
  const paragraphTexts = translation.get('paragraphs');
  const cueTexts = translation.get('cues');
  // What is shown, copied, read aloud and downloaded: the original, or a copy with
  // whichever parts have been translated so far. The original is never modified.
  const result = useMemo<TranscriptResult>(() => {
    if (!summaryTexts && !paragraphTexts && !cueTexts) return original;
    const base = summaryTexts ? withTranslatedSummary(original, summaryTexts, translation.language) : original;
    return {
      ...base,
      captions: { ...original.captions, languageCode: paragraphTexts ? translation.language : original.captions.languageCode },
      transcript: {
        paragraphs: original.transcript.paragraphs.map((p, i) => ({ ...p, text: paragraphTexts?.[i] ?? p.text })),
        cues: original.transcript.cues.map((cue, i) => ({ ...cue, text: cueTexts?.[i] ?? cue.text })),
      },
    };
  }, [original, summaryTexts, paragraphTexts, cueTexts, translation.language]);
  const { video, transcript, summary } = result;
  const translating = translation.language !== translation.sourceCode;
  const targetName = translation.languages.find((item) => item.code === translation.language)?.label ?? 'the chosen language';
  // Caption lines are translated last, so they may still be in the original language.
  const viewLang = (which: View) => ((which === 'captions' ? cueTexts : paragraphTexts) ? translation.language : original.captions.languageCode);
  const [view, setView] = useState<View>('paragraphs');
  const [timestamps, setTimestamps] = useState(true);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  // How many rows are rendered. The count belongs to one search + layout; when
  // either changes the stored count no longer applies and rendering restarts at one batch.
  const listKey = `${view}|${deferredQuery}`;
  const [rendered, setRendered] = useState({ key: listKey, count: BATCH });
  const visible = rendered.key === listKey ? rendered.count : BATCH;
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const switchId = useId();

  const rows = useMemo<Row[]>(() => {
    if (view === 'captions') {
      return transcript.cues.map((cue, index) => ({ key: `c${index}`, start: cue.start, text: cue.text }));
    }
    let section = -1;
    return transcript.paragraphs.map((paragraph, index) => {
      const opensSection = summary.sections.length > 1 && paragraph.sectionIndex !== section;
      section = paragraph.sectionIndex;
      return {
        key: `p${index}`,
        start: paragraph.start,
        text: paragraph.text,
        heading: opensSection ? summary.sections[paragraph.sectionIndex]?.title : undefined,
      };
    });
  }, [view, transcript, summary.sections]);

  const pattern = useMemo(() => (deferredQuery ? new RegExp(`(${escapeRegExp(deferredQuery)})`, 'gi') : null), [deferredQuery]);

  const { matches, matchCount } = useMemo(() => {
    if (!deferredQuery) return { matches: rows, matchCount: 0 };
    const counter = new RegExp(escapeRegExp(deferredQuery), 'gi');
    let total = 0;
    const filtered = rows.filter((row) => {
      const found = row.text.match(counter)?.length ?? 0;
      total += found;
      return found > 0;
    });
    return { matches: filtered, matchCount: total };
  }, [rows, deferredQuery]);

  // A new search or layout starts again from the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [listKey]);

  useEffect(() => {
    const target = sentinel.current;
    const root = scroller.current;
    if (!target || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRendered((previous) => ({ key: listKey, count: (previous.key === listKey ? previous.count : BATCH) + BATCH }));
      },
      { root, rootMargin: '600px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [listKey, matches.length, visible]);

  const copyText = () => {
    if (view === 'captions') return toCueText(transcript.cues, { timestamps });
    return transcript.paragraphs.map((p) => (timestamps ? `[${formatClock(p.start)}] ${p.text}` : p.text)).join('\n\n');
  };

  const shown = matches.slice(0, visible);
  // While the chosen language is not ready, placeholders stand in for the text.
  const textPending = translating && !(view === 'captions' ? cueTexts : paragraphTexts);
  const headingsPending = translating && !summaryTexts;

  return (
    <section className="rounded-2xl bg-white shadow-xs ring-1 ring-border">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:p-5">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search the transcript
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the transcript"
            autoComplete="off"
            className="h-9 w-full rounded-lg border border-input bg-white pr-9 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div role="group" aria-label="Transcript layout" className="inline-flex rounded-lg bg-muted p-0.5">
            {(
              [
                { value: 'paragraphs', label: 'Paragraphs', icon: AlignLeft },
                { value: 'captions', label: 'Captions', icon: Rows3 },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  view === value ? 'bg-white text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden /> {label}
              </button>
            ))}
          </div>

          <LanguageToggle translation={translation} parts={PARTS} />

          <div className="flex items-center gap-2">
            <Switch id={switchId} checked={timestamps} onCheckedChange={setTimestamps} />
            <label htmlFor={switchId} className="text-sm text-foreground/80 select-none">
              Timestamps
            </label>
          </div>

          <div className="flex items-center gap-2">
            <ListenButton
              id="transcript-all"
              label={deferredQuery ? 'the matching parts of the transcript' : 'the full transcript'}
              labelled
              variant="outline"
              lang={viewLang(view)}
              text={() => matches.map((row) => row.text).join(' ')}
            />
            <CopyButton getText={copyText} subject="Transcript" />
            <DownloadMenu result={result} scope="transcript" timestamps={timestamps} />
          </div>
        </div>
      </div>

      <p className="border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground sm:px-5" role="status" aria-live="polite">
        {deferredQuery
          ? matchCount > 0
            ? `${formatNumber(matchCount)} ${matchCount === 1 ? 'match' : 'matches'} for “${deferredQuery}” in ${formatNumber(matches.length)} ${view === 'captions' ? 'captions' : 'paragraphs'}`
            : `No matches for “${deferredQuery}”`
          : translating && !(view === 'captions' ? cueTexts : paragraphTexts)
            ? `Translating to ${targetName} on your device — the text appears here as soon as it is ready`
            : translating
              ? `${formatNumber(rows.length)} ${view === 'captions' ? 'captions' : 'paragraphs'} · machine translation made on your device`
              : view === 'captions'
                ? `${formatNumber(rows.length)} captions, exactly as timed on YouTube`
                : `${formatNumber(rows.length)} paragraphs · ${formatNumber(result.stats.wordCount)} words`}
      </p>

      <div ref={scroller} className="max-h-[70vh] overflow-y-auto overscroll-contain px-4 py-4 sm:px-5" tabIndex={0} aria-label="Transcript text" aria-busy={textPending}>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing in the transcript matches your search.</p>
        ) : (
          <div className={view === 'captions' ? 'space-y-1.5' : 'space-y-4'}>
            {shown.map((row) => (
              <Fragment key={row.key}>
                {row.heading && !deferredQuery && (
                  <h3 className="border-b border-border pt-3 pb-1.5 text-sm font-semibold text-primary first:pt-0">
                    {headingsPending ? <TextSkeleton text={row.heading} charsPerLine={60} className="max-w-xs" /> : row.heading}
                  </h3>
                )}
                <div className="flex gap-3">
                  {timestamps && <Timestamp videoId={video.id} seconds={row.start} className="mt-0.5" />}
                  {textPending ? (
                    <TextSkeleton text={row.text} charsPerLine={view === 'captions' ? 60 : 130} />
                  ) : (
                    <p className={cn('min-w-0 flex-1 text-foreground/90', view === 'captions' ? 'text-sm leading-6' : 'text-[0.95rem] leading-7')}>
                      <Highlighted text={row.text} pattern={pattern} />
                    </p>
                  )}
                  {view === 'paragraphs' && !textPending && (
                    <ListenButton id={`transcript-${row.key}`} label={`the paragraph at ${formatClock(row.start)}`} lang={viewLang('paragraphs')} text={row.text} />
                  )}
                </div>
              </Fragment>
            ))}
          </div>
        )}
        {visible < matches.length && <div ref={sentinel} className="h-8" aria-hidden />}
      </div>
    </section>
  );
}
