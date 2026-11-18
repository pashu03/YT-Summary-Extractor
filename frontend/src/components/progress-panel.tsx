'use client';

import { Check, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { Progress as ProgressState } from '@/hooks/use-transcript';
import { cn } from '@/lib/utils';
import type { Stage } from '@/types/api';

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'validate', label: 'Check link' },
  { stage: 'metadata', label: 'Video details' },
  { stage: 'captions', label: 'Captions' },
  { stage: 'transcript', label: 'Transcript' },
  { stage: 'analysis', label: 'Analysis' },
  { stage: 'summary', label: 'Summary' },
];

const ORDER: Stage[] = [...STEPS.map((step) => step.stage), 'done'];

export function ProgressPanel({ progress }: { progress: ProgressState }) {
  const current = ORDER.indexOf(progress.stage);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border sm:p-6" aria-busy="true">
      <div className="flex items-center justify-between gap-4">
        {/* Announced to screen readers each time the stage changes. */}
        <p className="flex items-center gap-2 text-sm font-medium text-foreground" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-chart-1" aria-hidden />
          {progress.message}…
        </p>
        <span className="text-sm font-semibold text-primary tabular-nums">{Math.round(progress.percent)}%</span>
      </div>

      <Progress value={progress.percent} className="mt-3 h-2 bg-chart-2 [&>[data-slot=progress-indicator]]:bg-chart-1" aria-label="Processing progress" />

      <ol className="mt-5 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
        {STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.stage} className="flex items-center gap-2 text-xs sm:text-[0.8rem]">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold',
                  done && 'bg-primary text-primary-foreground',
                  active && 'bg-chart-1 text-white',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
                aria-hidden
              >
                {done ? <Check className="size-3" /> : index + 1}
              </span>
              <span className={cn('truncate', done || active ? 'font-medium text-foreground' : 'text-muted-foreground')}>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
