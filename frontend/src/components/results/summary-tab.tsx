'use client';

import { CopyButton } from '@/components/copy-button';
import { DownloadMenu } from '@/components/download-menu';
import { ListenButton } from '@/components/speech';
import { TextSkeleton } from '@/components/text-skeleton';
import { Timestamp } from '@/components/timestamp';
import { Badge } from '@/components/ui/badge';
import { toSummaryText } from '@/lib/exporters';
import { formatClock, formatPercent } from '@/lib/format';
import { withTranslatedSummary } from '@/lib/translate';
import type { TranscriptResult } from '@/types/api';
import { LanguageToggle, type ResultTranslation } from './translation';

export function SummaryTab({ result: original, translation }: { result: TranscriptResult; translation: ResultTranslation }) {
  const { language, sourceName } = translation;
  const translated = translation.get('summary');
  // Everything below renders `result`: the original, or a copy with translated summary text.
  const result = translated ? withTranslatedSummary(original, translated, language) : original;
  const { video, summary, stats } = result;
  const lang = result.captions.languageCode;
  // A translated language is chosen but not ready yet: placeholders stand in for the text.
  const pending = language !== translation.sourceCode && !translated;
  const sections = summary.sections.filter((section) => section.points.length > 0);
  const fromChapters = summary.sections[0]?.source === 'chapter';

  return (
    <div className="space-y-5" aria-busy={pending}>
      <section className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-border sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-2xl">
            <h3 className="text-base font-semibold text-foreground">Detailed summary</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {sections.length > 1
                ? `The video in ${sections.length} sections${fromChapters ? ", following the creator's chapters" : ', detected from shifts in vocabulary'}. `
                : ''}
              Every line is quoted from the video and ranked with TF-IDF and TextRank — nothing is rewritten or generated.
            </p>
            {translated && (
              <p className="mt-1 text-sm text-muted-foreground">
                Showing a machine translation made on your device. Switch to {sourceName} for the original wording.
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <LanguageToggle translation={translation} parts={['summary']} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ListenButton
                id="summary-all"
                label="the whole detailed summary"
                labelled
                variant="outline"
                lang={lang}
                text={() => sections.map((s) => `${s.title}. ${s.points.map((p) => p.text).join(' ')}`).join(' ')}
              />
              <CopyButton getText={() => toSummaryText(result)} subject="Summary" />
              <DownloadMenu result={result} scope="summary" />
            </div>
          </div>
        </div>

        {summary.short.length > 0 && (
          <div className="mt-5 rounded-xl bg-secondary p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">In brief</p>
              <ListenButton id="summary-brief" label="the brief summary" lang={lang} text={() => summary.short.map((s) => s.text).join(' ')} />
            </div>
            {pending ? (
              <TextSkeleton text={summary.short.map((s) => s.text).join(' ')} charsPerLine={140} className="mt-2" />
            ) : (
              <p className="mt-2 text-[0.95rem] leading-7 text-foreground/90">{summary.short.map((s) => s.text).join(' ')}</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Summary is {formatPercent(stats.compression)} of the transcript&apos;s length.
            </p>
          </div>
        )}
      </section>

      <ol className="space-y-4">
        {sections.map((section, position) => (
          <li key={section.index} className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-border sm:p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
                {position + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h4 className="text-base leading-snug font-semibold text-foreground">
                  {pending ? <TextSkeleton text={section.title} charsPerLine={60} className="max-w-sm" /> : section.title}
                </h4>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Timestamp videoId={video.id} seconds={section.start} />
                  <span>to {formatClock(section.end)}</span>
                  <span aria-hidden>·</span>
                  <span>{formatPercent(section.share)} of the transcript</span>
                </div>
              </div>
              <ListenButton
                id={`summary-section-${section.index}`}
                label={`section ${position + 1}, ${section.title}`}
                lang={lang}
                text={() => `${section.title}. ${section.points.map((p) => p.text).join(' ')}`}
              />
            </div>

            <ul className="mt-4 space-y-3 sm:pl-10">
              {section.points.map((point, index) => (
                <li key={`${point.start}-${index}`} className="flex gap-3">
                  <Timestamp videoId={video.id} seconds={point.start} className="mt-0.5" />
                  {pending ? (
                    <TextSkeleton text={point.text} charsPerLine={130} />
                  ) : (
                    <p className="min-w-0 flex-1 text-sm leading-6 text-foreground/90">{point.text}</p>
                  )}
                </li>
              ))}
            </ul>

            {section.keywords.length > 0 && !pending && (
              <ul className="mt-4 flex flex-wrap gap-1.5 sm:pl-10" aria-label="Keywords in this section">
                {section.keywords.map((keyword) => (
                  <li key={keyword}>
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {keyword}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
