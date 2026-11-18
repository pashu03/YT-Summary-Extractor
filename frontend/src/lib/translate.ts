import type { TranscriptResult } from '@/types/api';

/**
 * Translation uses the browser's built-in Translator API (Chrome 138+ on
 * desktop). The language model runs on the visitor's device: text is never
 * sent to this app's server or to any other service.
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?: () => void;
}

interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorFactory {
  availability(pair: LanguagePair): Promise<Availability>;
  create(
    options: LanguagePair & { monitor?: (monitor: EventTarget) => void; signal?: AbortSignal },
  ): Promise<TranslatorInstance>;
}

export class TranslationError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'unavailable' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

const translatorApi = (): TranslatorFactory | null =>
  (globalThis as { Translator?: TranslatorFactory }).Translator ?? null;

export const isTranslationSupported = () => translatorApi() !== null;

/** "en-US" → "en". The translator works with base language codes. */
export const baseLanguage = (code: string) => code.toLowerCase().split(/[-_]/)[0];

export interface TranslationProgress {
  /** "download" while the language pack is fetched (first use only), then "translate". */
  phase: 'download' | 'translate';
  /** 0–1. */
  fraction: number;
}

/**
 * Translate a list of texts, keeping their order. The first use of a language
 * pair downloads a language pack to the device, which can take a minute.
 */
export async function translateTexts(
  texts: string[],
  source: string,
  target: string,
  onProgress: (progress: TranslationProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const api = translatorApi();
  if (!api) {
    throw new TranslationError('unsupported', 'Translation needs a recent desktop version of Chrome or Edge with built-in translation.');
  }

  const pair = { sourceLanguage: baseLanguage(source), targetLanguage: baseLanguage(target) };
  let availability: Availability;
  try {
    availability = await api.availability(pair);
  } catch {
    availability = 'unavailable';
  }
  if (availability === 'unavailable') {
    throw new TranslationError('unavailable', "Your browser can't translate between these two languages.");
  }

  let translator: TranslatorInstance;
  try {
    translator = await api.create({
      ...pair,
      signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          onProgress({ phase: 'download', fraction: (event as ProgressEvent).loaded ?? 0 });
        });
      },
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new TranslationError('failed', "The browser couldn't prepare the translation. Check your connection and try again.");
  }

  try {
    const translated: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (signal?.aborted) throw new DOMException('Translation cancelled.', 'AbortError');
      // Empty strings are passed through; the translator rejects them.
      translated.push(texts[i].trim() ? await translator.translate(texts[i]) : texts[i]);
      onProgress({ phase: 'translate', fraction: (i + 1) / texts.length });
    }
    return translated;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new TranslationError('failed', 'The translation stopped unexpectedly. Please try again.');
  } finally {
    translator.destroy?.();
  }
}

/** Every piece of text in the summary, in a fixed order. */
export function collectSummaryTexts(result: TranscriptResult): string[] {
  const { summary } = result;
  return [
    ...summary.short.map((item) => item.text),
    ...summary.takeaways.map((item) => item.text),
    ...summary.sections.flatMap((section) => [section.title, ...section.points.map((point) => point.text), ...section.keywords]),
  ];
}

/**
 * A copy of the result with the summary texts replaced by translations given
 * in the order of `collectSummaryTexts`. The original result is not modified;
 * timestamps, statistics and the transcript itself are kept as they are.
 */
export function withTranslatedSummary(result: TranscriptResult, texts: string[], language: string): TranscriptResult {
  let cursor = 0;
  const next = (fallback: string) => texts[cursor++] ?? fallback;
  const summary = {
    short: result.summary.short.map((item) => ({ ...item, text: next(item.text) })),
    takeaways: result.summary.takeaways.map((item) => ({ ...item, text: next(item.text) })),
    sections: result.summary.sections.map((section) => ({
      ...section,
      title: next(section.title),
      points: section.points.map((point) => ({ ...point, text: next(point.text) })),
      keywords: section.keywords.map((keyword) => next(keyword)),
    })),
  };
  return { ...result, summary, captions: { ...result.captions, languageCode: language } };
}
