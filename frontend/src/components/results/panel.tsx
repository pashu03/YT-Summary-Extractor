import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PanelProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Buttons shown at the right of the heading. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The card used for every block of the results dashboard. */
export function Panel({ title, description, icon: Icon, action, className, children }: PanelProps) {
  return (
    <section className={cn('rounded-2xl bg-white p-5 shadow-xs ring-1 ring-border sm:p-6', className)}>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            {Icon && (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            {title}
          </h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      {children}
    </section>
  );
}
