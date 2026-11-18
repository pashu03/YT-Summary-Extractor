'use client';

import { ArrowRight, ListChecks, ListTree, Quote, Tags } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { ListenButton } from '@/components/speech';
import { Timestamp } from '@/components/timestamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatNumber, formatPercent, formatReadingTime } from '@/lib/format';
import type { TranscriptResult } from '@/types/api';
import { Panel } from './panel';
import type { ResultTab } from './results-dashboard';

interface OverviewTabProps {
  result: TranscriptResult;
  onNavigate: (tab: ResultTab) => void;
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-border">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      {/* Proportional figures: tabular digits look loose at this size. */}
      <dd className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

export function OverviewTab({ result, onNavigate }: OverviewTabProps) {
  const { video, summary, keywords, stats } = result;
  const lang = result.captions.languageCode;
  const shortText = summary.short.map((sentence) => sentence.text).join(' ');
  const takeawaysText = summary.takeaways.map((item) => `• ${item.text}`).join('\n');

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Words" value={formatNumber(stats.wordCount)} note={`${formatNumber(stats.sentenceCount)} sentences`} />
        <StatTile label="Reading time" value={formatReadingTime(stats.readingMinutes)} note="at 230 words per minute" />
        <StatTile label="Speaking pace" value={`${formatNumber(stats.speakingRateWpm)} wpm`} note="words per minute spoken" />
        <StatTile label="Sections" value={String(stats.sectionCount)} note={summary.sections[0]?.source === 'chapter' ? 'creator chapters' : 'detected topics'} />
        <StatTile label="Summary size" value={formatPercent(stats.compression)} note="of the full transcript" />
      </dl>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel
            icon={Quote}
            title="Summary"
            description="The most central sentences in the video, in the order they are said."
            action={
              <>
                <ListenButton id="overview-summary" label="the summary" labelled variant="outline" lang={lang} text={shortText} />
                <CopyButton getText={() => shortText} subject="Summary" />
              </>
            }
          >
            {summary.short.length > 0 ? (
              <p className="text-[0.95rem] leading-7 text-foreground/90">{shortText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">This video is too short to summarise. The full transcript is on the next tab.</p>
            )}
          </Panel>

          {summary.takeaways.length > 0 && (
            <Panel
              icon={ListChecks}
              title="Key takeaways"
              description="Distinct points from across the video. Select a time to hear it in context."
              action={
                <>
                  <ListenButton
                    id="overview-takeaways"
                    label="the key takeaways"
                    labelled
                    variant="outline"
                    lang={lang}
                    text={() => summary.takeaways.map((item) => item.text).join(' ')}
                  />
                  <CopyButton getText={() => takeawaysText} subject="Takeaways" />
                </>
              }
            >
              <ol className="space-y-3">
                {summary.takeaways.map((item, index) => (
                  <li key={`${item.start}-${index}`} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
                      {index + 1}
                    </span>
                    <p className="min-w-0 flex-1 text-sm leading-6 text-foreground/90">
                      {item.text} <Timestamp videoId={video.id} seconds={item.start} className="ml-1 align-middle" />
                    </p>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel
            icon={ListTree}
            title="Outline"
            action={
              <>
                <ListenButton id="overview-outline" label="the outline" lang={lang} text={() => summary.sections.map((s) => s.title).join('. ')} />
                <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('summary')}>
                  Details <ArrowRight />
                </Button>
              </>
            }
          >
            <ol className="-my-1 divide-y divide-border">
              {summary.sections.map((section) => (
                <li key={section.index} className="flex items-start gap-3 py-2.5">
                  <Timestamp videoId={video.id} seconds={section.start} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6 font-medium text-foreground">{section.title}</p>
                    <p className="text-xs text-muted-foreground">{formatPercent(section.share)} of the transcript</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          {keywords.length > 0 && (
            <Panel
              icon={Tags}
              title="Top keywords"
              action={
                <>
                  <ListenButton id="overview-keywords" label="the top keywords" lang={lang} text={() => keywords.slice(0, 12).map((k) => k.term).join(', ')} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('topics')}>
                    All <ArrowRight />
                  </Button>
                </>
              }
            >
              <ul className="flex flex-wrap gap-2">
                {keywords.slice(0, 12).map((keyword) => (
                  <li key={keyword.term}>
                    <Badge variant="secondary" className="h-7 px-3 text-[0.8rem] font-medium">
                      {keyword.term}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
