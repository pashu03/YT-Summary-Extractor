import { formatClock, youtubeTimeUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TimestampProps {
  videoId: string;
  seconds: number;
  className?: string;
}

/** A timestamp chip that opens the video on YouTube at that moment. */
export function Timestamp({ videoId, seconds, className }: TimestampProps) {
  const clock = formatClock(seconds);
  return (
    <a
      href={youtubeTimeUrl(videoId, seconds)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open the video at ${clock}`}
      aria-label={`Open the video at ${clock}`}
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-md bg-secondary px-1.5 font-mono text-xs font-medium text-primary tabular-nums',
        'transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {clock}
    </a>
  );
}
