import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface TextSkeletonProps {
  /** The text being replaced; its length decides how many lines the placeholder has. */
  text?: string;
  /** Explicit number of lines, when there is no text to measure. */
  lines?: number;
  /** Roughly how many characters fit on a line where this is shown. */
  charsPerLine?: number;
  className?: string;
}

/**
 * Pulsing grey lines that stand in for text that is still being produced.
 * They take about the same space as the text will, so the page does not jump
 * when the real content arrives.
 */
export function TextSkeleton({ text, lines, charsPerLine = 100, className }: TextSkeletonProps) {
  const count = lines ?? Math.max(1, Math.min(6, Math.ceil((text?.length ?? charsPerLine) / charsPerLine)));
  const short = text !== undefined && text.length < charsPerLine;
  return (
    <span className={cn('flex min-w-0 flex-1 flex-col gap-2.5 py-1.5', className)} aria-hidden>
      {Array.from({ length: count }, (_, index) => {
        const last = index === count - 1;
        // A single short piece of text gets a short bar; the last line of a paragraph is ragged.
        const width = short ? `${Math.max(18, Math.round((text.length / charsPerLine) * 100))}%` : last && count > 1 ? '62%' : '100%';
        return <Skeleton key={index} className="h-3 rounded-full bg-chart-2/70" style={{ width }} />;
      })}
    </span>
  );
}

/** Placeholder for the results dashboard, shown while a video is being processed. */
export function ResultsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="flex gap-2 rounded-xl bg-white p-1 shadow-xs ring-1 ring-border sm:w-fit">
        {[84, 112, 132, 164].map((width) => (
          <Skeleton key={width} className="h-9 flex-1 rounded-lg sm:flex-none" style={{ minWidth: width / 2, width }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="space-y-2.5 rounded-xl bg-white p-4 shadow-xs ring-1 ring-border">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-2.5 w-24 rounded-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-xs ring-1 ring-border lg:col-span-2">
          <Skeleton className="h-5 w-32" />
          <TextSkeleton lines={5} />
        </div>
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-xs ring-1 ring-border">
          <Skeleton className="h-5 w-24" />
          <TextSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}
