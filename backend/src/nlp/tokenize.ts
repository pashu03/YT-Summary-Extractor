import { stemmer } from 'stemmer';
import { getStopwords, primaryLanguage } from './stopwords.js';

export interface Token {
  /** The word as written in the transcript. */
  raw: string;
  /** Lower-cased form with possessives removed. */
  norm: string;
  /** Stemmed form used to match inflections ("networks" → "network"). English only. */
  stem: string;
  /** False for stopwords, numbers and single characters. */
  content: boolean;
  /** Character offsets of the word in the source text. */
  start: number;
  end: number;
}

export interface Tokenizer {
  language: string;
  /** False for scripts written without spaces between words (Japanese, Chinese, Thai…). */
  usesSpaces: boolean;
  tokenize(text: string): Token[];
}

/** Languages whose words are not separated by spaces; these need dictionary-based segmentation. */
const UNSPACED = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my']);

// A word: letters/digits/combining marks, optionally joined by apostrophes or hyphens.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;
const NUMERIC = /^[\d][\d.,'’-]*$/;

export function createTokenizer(languageCode: string | undefined): Tokenizer {
  const language = primaryLanguage(languageCode);
  const stopwords = getStopwords(language);
  const usesSpaces = !UNSPACED.has(language);
  const segmenter = usesSpaces ? null : new Intl.Segmenter(language, { granularity: 'word' });

  const stemCache = new Map<string, string>();
  const stem = (word: string): string => {
    if (language !== 'en') return word;
    let value = stemCache.get(word);
    if (value === undefined) {
      value = stemmer(word);
      stemCache.set(word, value);
    }
    return value;
  };

  const build = (raw: string, start: number): Token => {
    const lower = raw.toLowerCase().replace(/’/g, "'");
    const norm = lower.replace(/'s$/, '');
    const content = norm.length >= 2 && !NUMERIC.test(norm) && !stopwords.has(lower) && !stopwords.has(norm);
    return { raw, norm, stem: content ? stem(norm) : norm, content, start, end: start + raw.length };
  };

  return {
    language,
    usesSpaces,
    tokenize(text: string): Token[] {
      const tokens: Token[] = [];
      if (segmenter) {
        for (const part of segmenter.segment(text)) {
          if (part.isWordLike) tokens.push(build(part.segment, part.index));
        }
        return tokens;
      }
      for (const match of text.matchAll(WORD)) tokens.push(build(match[0], match.index));
      return tokens;
    },
  };
}
