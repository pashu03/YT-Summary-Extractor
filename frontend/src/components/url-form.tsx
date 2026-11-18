'use client';

import { ArrowRight, ClipboardPaste, Link2, Loader2, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { checkYouTubeUrl } from '@/lib/youtube';
import { cn } from '@/lib/utils';

interface Example {
  label: string;
  url: string;
}

/** Public videos with good captions, for trying the tool without hunting for a link. */
const EXAMPLES: Example[] = [
  { label: 'Neural networks · 19 min', url: 'https://www.youtube.com/watch?v=aircAruvnKk' },
  { label: 'React in 100 seconds', url: 'https://youtu.be/Tn6-PIqc4UM' },
  { label: 'MIT AI lecture · 47 min', url: 'https://www.youtube.com/watch?v=TjZBTDzGeGg' },
];

interface UrlFormProps {
  loading: boolean;
  /** Example links are only offered on the landing view. */
  showExamples: boolean;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}

export function UrlForm({ loading, showExamples, onSubmit, onCancel }: UrlFormProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  const start = (url: string) => {
    const check = checkYouTubeUrl(url);
    if (!check.ok) {
      setError(check.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit(url.trim());
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setValue(text);
        setError(null);
      }
    } catch {
      // Clipboard access was declined; the field is focused so Ctrl+V still works.
    }
    inputRef.current?.focus();
  };

  return (
    <div className="w-full">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading) start(value);
        }}
        className={cn(
          'flex flex-col gap-2 rounded-2xl bg-white p-2 shadow-[0_12px_40px_-12px_rgb(11_42_91/0.25)] ring-1 ring-border transition-shadow sm:flex-row sm:items-center',
          'focus-within:ring-2 focus-within:ring-ring',
          error && 'ring-2 ring-destructive/60 focus-within:ring-destructive/60',
        )}
      >
        <label htmlFor={inputId} className="sr-only">
          YouTube video URL
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-1 pl-3">
          <Link2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            id={inputId}
            type="url"
            inputMode="url"
            name="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Paste a YouTube video link"
            value={value}
            disabled={loading}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80 disabled:opacity-60"
          />
          {value && !loading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear the link"
              onClick={() => {
                setValue('');
                setError(null);
                inputRef.current?.focus();
              }}
            >
              <X />
            </Button>
          ) : (
            !loading && (
              <Button type="button" variant="ghost" size="sm" onClick={paste} className="text-muted-foreground">
                <ClipboardPaste /> Paste
              </Button>
            )
          )}
        </div>

        {/* Distinct keys make these two separate DOM buttons. Sharing one would turn the
            Cancel button into a submit button mid-click and immediately resubmit the form. */}
        {loading ? (
          <Button key="cancel" type="button" variant="outline" onClick={onCancel} className="h-12 rounded-xl px-5 text-base">
            <Loader2 className="animate-spin" /> Cancel
          </Button>
        ) : (
          <Button key="submit" type="submit" className="h-12 rounded-xl px-6 text-base font-semibold shadow-sm">
            Generate Transcript <ArrowRight />
          </Button>
        )}
      </form>

      <p id={errorId} role="alert" className={cn('mt-2 min-h-5 px-2 text-left text-sm font-medium text-destructive', !error && 'invisible')}>
        {error ?? ' '}
      </p>

      {showExamples && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-muted-foreground">Try an example:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.url}
              type="button"
              disabled={loading}
              onClick={() => {
                setValue(example.url);
                start(example.url);
              }}
              className="rounded-full border border-border bg-white px-3 py-1 text-sm text-foreground/80 transition-colors hover:border-ring hover:bg-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              {example.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
