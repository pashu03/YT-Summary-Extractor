'use client';

import { Layers, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { ListenButton } from '@/components/speech';
import { Timestamp } from '@/components/timestamp';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatClock, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Keyword, SectionSummary, TranscriptResult } from '@/types/api';
import { Panel } from './panel';

type KeywordFilter = 'all' | 'word' | 'phrase';

const FILTERS: { value: KeywordFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'word', label: 'Words' },
  { value: 'phrase', label: 'Phrases' },
];

/**
 * The video as one thin bar split into its sections. Position, not colour,
 * identifies a section: every part is the same blue, separated by a gap, and
 * the list underneath names them in the same order.
 */
function Timeline({
  sections,
  active,
  onActivate,
}: {
  sections: SectionSummary[];
  active: number | null;
  onActivate: (index: number | null) => void;
}) {
  const start = sections[0]?.start ?? 0;
  const end = sections[sections.length - 1]?.end ?? 0;
  const total = Math.max(1, end - start);

  return (
    <div>
      <div className="flex h-6 items-center gap-0.5" role="group" aria-label="Sections along the video timeline">
        {sections.map((section) => (
          <Tooltip key={section.index}>
            <TooltipTrigger asChild>
              <button
                type="button"
                // The hit area is the full 24px row, taller than the 8px mark.
                className="group flex h-6 min-w-1 items-center focus-visible:outline-none"
                style={{ flexGrow: Math.max(section.end - section.start, total * 0.004), flexBasis: 0 }}
                onPointerEnter={() => onActivate(section.index)}
                onPointerLeave={() => onActivate(null)}
                onFocus={() => onActivate(section.index)}
                onBlur={() => onActivate(null)}
                aria-label={`${section.title}: ${formatClock(section.start)} to ${formatClock(section.end)}, ${formatPercent(section.share)} of the transcript`}
              >
                <span
                  className={cn(
                    'block h-2 w-full rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2',
                    active === null || active === section.index ? 'bg-chart-1' : 'bg-chart-3',
                    active === section.index && 'bg-chart-4',
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">
                {formatClock(section.start)} – {formatClock(section.end)} · {formatPercent(section.share)}
              </p>
              <p className="opacity-80">{section.title}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{formatClock(start)}</span>
        <span>{formatClock(end)}</span>
      </div>
    </div>
  );
}

/** One ranked keyword: the bar is a meter of relevance on a lighter track of the same blue. */
function KeywordRow({ keyword, rank }: { keyword: Keyword; rank: number }) {
  const relevance = Math.round(keyword.score * 100);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <li
          tabIndex={0}
          className="grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-x-3 rounded-lg px-2 py-1.5 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[1.5rem_minmax(0,11rem)_minmax(0,1fr)_3rem]"
        >
          <span className="text-right text-xs text-muted-foreground tabular-nums">{rank}</span>
          <span className="truncate text-sm font-medium text-foreground">{keyword.term}</span>
          <span className="col-span-2 col-start-2 row-start-2 block h-2 overflow-hidden rounded-full bg-chart-2 sm:col-span-1 sm:col-start-3 sm:row-start-1" aria-hidden>
            <span className="block h-full rounded-r-full bg-chart-1" style={{ width: `${Math.max(relevance, 2)}%` }} />
          </span>
          <span className="col-start-3 row-start-1 text-right text-xs text-muted-foreground tabular-nums sm:col-start-4">{keyword.count}×</span>
        </li>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p className="font-semibold">Relevance {relevance}</p>
        <p className="opacity-80">
          {keyword.kind === 'phrase' ? 'Phrase' : 'Word'} · said {keyword.count} {keyword.count === 1 ? 'time' : 'times'}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function TopicsTab({ result }: { result: TranscriptResult }) {
  const { video, summary, keywords } = result;
  const lang = result.captions.languageCode;
  const [active, setActive] = useState<number | null>(null);
  const [filter, setFilter] = useState<KeywordFilter>('all');

  const shownKeywords = useMemo(() => (filter === 'all' ? keywords : keywords.filter((k) => k.kind === filter)), [keywords, filter]);
  const hasPhrases = keywords.some((k) => k.kind === 'phrase');
  const fromChapters = summary.sections[0]?.source === 'chapter';

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Panel
        icon={Layers}
        title="Key topics"
        description={
          fromChapters
            ? "Sections follow the creator's chapters. Each is labelled with the terms that set it apart."
            : 'Sections are detected where the vocabulary shifts, and named after their most distinctive terms.'
        }
        action={
          <ListenButton
            id="topics-list"
            label="the key topics"
            labelled
            variant="outline"
            lang={lang}
            text={() => summary.sections.map((s) => (s.keywords.length ? `${s.title}: ${s.keywords.join(', ')}` : s.title)).join('. ')}
          />
        }
      >
        {summary.sections.length > 1 && <Timeline sections={summary.sections} active={active} onActivate={setActive} />}

        <ol className={cn('divide-y divide-border', summary.sections.length > 1 && 'mt-4')}>
          {summary.sections.map((section) => (
            <li
              key={section.index}
              onPointerEnter={() => setActive(section.index)}
              onPointerLeave={() => setActive(null)}
              className={cn('-mx-2 flex gap-3 rounded-lg px-2 py-3 transition-colors', active === section.index && 'bg-secondary')}
            >
              <Timestamp videoId={video.id} seconds={section.start} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm leading-6 font-semibold text-foreground">{section.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatPercent(section.share)}</span>
                </div>
                {section.keywords.length > 0 && <p className="mt-0.5 text-sm text-muted-foreground">{section.keywords.join(' · ')}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        icon={Tags}
        title="Keywords"
        description="Ranked by relevance: TextRank over a word co-occurrence graph, blended with how often each term is said."
        action={
          <>
            <ListenButton id="topics-keywords" label="the keywords" labelled variant="outline" lang={lang} text={() => shownKeywords.map((k) => k.term).join(', ')} />
            <CopyButton getText={() => shownKeywords.map((k) => k.term).join(', ')} subject="Keywords" />
          </>
        }
      >
        {keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground">This transcript is too short to extract keywords from.</p>
        ) : (
          <>
            {hasPhrases && (
              <div role="group" aria-label="Keyword type" className="mb-3 inline-flex rounded-lg bg-muted p-0.5">
                {FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={cn(
                      'h-7 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      filter === value ? 'bg-white text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="mb-1 grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] gap-x-3 px-2 text-xs text-muted-foreground sm:grid-cols-[1.5rem_minmax(0,11rem)_minmax(0,1fr)_3rem]" aria-hidden>
              <span className="text-right">#</span>
              <span>Term</span>
              <span className="hidden sm:block">Relevance</span>
              <span className="text-right">Said</span>
            </div>
            <ol className="-mx-2">
              {shownKeywords.map((keyword, index) => (
                <KeywordRow key={keyword.term} keyword={keyword} rank={index + 1} />
              ))}
            </ol>
          </>
        )}
      </Panel>
    </div>
  );
}
