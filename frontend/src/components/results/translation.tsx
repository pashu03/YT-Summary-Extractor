'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { baseLanguage, collectSummaryTexts, isTranslationSupported, translateTexts, TranslationError } from '@/lib/translate';
import { cn } from '@/lib/utils';
import type { TranscriptResult } from '@/types/api';

/** The pieces of a result that can be translated independently. */
export type TranslationPart = 'summary' | 'paragraphs' | 'cues';

/** Languages content can be shown in, besides the one it was spoken in. */
const TARGETS = [
  { code: 'hi', label: 'Hindi' },
  { code: 'en', label: 'English' },
];

const PART_LABEL: Record<TranslationPart, string> = {
  summary: 'Translating summary',
  paragraphs: 'Translating transcript',
  cues: 'Translating captions',
};

const noSubscription = () => () => {};

export interface ResultTranslation {
  /** Language of the original captions, e.g. "mr". */
  sourceCode: string;
  sourceName: string;
  languages: { code: string; label: string }[];
  /** Whether this browser can translate at all. */
  supported: boolean;
  /** The language currently chosen. */
  language: string;
  /** What is being worked on right now, for a progress note. */
  busy: string | null;
  /** Switch language and translate the given parts if they are not ready yet. */
  choose: (code: string, parts: TranslationPart[]) => void;
  /** Make sure the given parts exist in the chosen language (used when changing tab). */
  ensure: (parts: TranslationPart[]) => void;
  /** Translated texts for a part in the chosen language, or undefined while showing the original. */
  get: (part: TranslationPart) => string[] | undefined;
}

function textsOf(result: TranscriptResult, part: TranslationPart): string[] {
  if (part === 'summary') return collectSummaryTexts(result);
  if (part === 'paragraphs') return result.transcript.paragraphs.map((paragraph) => paragraph.text);
  return result.transcript.cues.map((cue) => cue.text);
}

/**
 * One language choice shared by every tab of a result. Translations are made
 * on the device, kept in memory for as long as the result is on screen, and
 * never replace the original text.
 */
export function useResultTranslation(original: TranscriptResult): ResultTranslation {
  const sourceCode = baseLanguage(original.captions.languageCode);
  const sourceName = original.captions.name.replace(/\s*[-(].*$/, '').trim() || 'Original';
  const languages = useMemo(
    () => [{ code: sourceCode, label: sourceName }, ...TARGETS.filter((target) => target.code !== sourceCode)],
    [sourceCode, sourceName],
  );

  const supported = useSyncExternalStore(noSubscription, isTranslationSupported, () => false);
  const [language, setLanguage] = useState(sourceCode);
  const [busy, setBusy] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, string[]>>({});
  // Mirror of `cache` that the translation loop can read between awaits.
  const known = useRef<Record<string, string[]>>({});
  const job = useRef<AbortController | null>(null);

  const run = useCallback(
    async (code: string, parts: TranslationPart[]) => {
      job.current?.abort();
      job.current = null;
      const missing = parts.filter((part) => !known.current[`${code}:${part}`]);
      if (code === sourceCode || missing.length === 0) {
        setBusy(null);
        return;
      }

      const controller = new AbortController();
      job.current = controller;
      setBusy('Preparing translation…');
      try {
        for (const part of missing) {
          const texts = await translateTexts(
            textsOf(original, part),
            sourceCode,
            code,
            ({ phase, fraction }) => {
              if (controller.signal.aborted) return;
              const percent = Math.round(fraction * 100);
              setBusy(phase === 'download' ? `Downloading language pack ${percent}%` : `${PART_LABEL[part]} ${percent}%`);
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          // Each part appears as soon as it is ready, without waiting for the rest.
          known.current = { ...known.current, [`${code}:${part}`]: texts };
          setCache(known.current);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        toast.error("Couldn't translate", {
          description: err instanceof TranslationError ? err.message : 'Something went wrong. Please try again.',
        });
        // Nothing to show in this language: go back to the original rather than look translated.
        if (!Object.keys(known.current).some((key) => key.startsWith(`${code}:`))) setLanguage(sourceCode);
      } finally {
        if (job.current === controller) {
          job.current = null;
          setBusy(null);
        }
      }
    },
    [original, sourceCode],
  );

  const choose = useCallback(
    (code: string, parts: TranslationPart[]) => {
      setLanguage(code);
      void run(code, parts);
    },
    [run],
  );

  const ensure = useCallback((parts: TranslationPart[]) => void run(language, parts), [run, language]);

  const get = useCallback(
    (part: TranslationPart) => (language === sourceCode ? undefined : cache[`${language}:${part}`]),
    [cache, language, sourceCode],
  );

  // Stop any translation still running when the result leaves the screen.
  useEffect(() => () => job.current?.abort(), []);

  return { sourceCode, sourceName, languages, supported, language, busy, choose, ensure, get };
}

/** The compact language switch shown on the tabs whose content can be translated. */
export function LanguageToggle({ translation, parts }: { translation: ResultTranslation; parts: TranslationPart[] }) {
  const { languages, language, sourceCode, supported, busy, choose } = translation;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {busy && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {busy}
        </span>
      )}
      <div role="group" aria-label="Content language" className="inline-flex rounded-lg bg-muted p-0.5">
        {languages.map(({ code, label }) => {
          const isOriginal = code === sourceCode;
          const disabled = !isOriginal && !supported;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={language === code}
              disabled={disabled}
              onClick={() => choose(code, parts)}
              title={
                disabled
                  ? 'Translation needs a recent desktop version of Chrome or Edge'
                  : isOriginal
                    ? 'Show the original wording'
                    : `Translate to ${label}`
              }
              className={cn(
                'h-7 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
                language === code ? 'bg-white text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
