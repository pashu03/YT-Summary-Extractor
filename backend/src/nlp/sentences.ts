import type { RawCue } from '../youtube/captions.js';
import type { Token, Tokenizer } from './tokenize.js';

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
  wordCount: number;
  tokens: Token[];
  /** Stems of the content words, in order, with repeats. */
  stems: string[];
  /** Seconds of silence between the previous sentence and this one. */
  gapBefore: number;
}

export interface SentenceSet {
  sentences: Sentence[];
  /** Whether the captions carry sentence punctuation (human-made and newer auto captions do). */
  punctuated: boolean;
}

/** The smallest timed piece of speech: a word, or a whole cue for scripts written without spaces. */
interface Unit {
  text: string;
  time: number;
  /** Size in words. */
  weight: number;
  /** First unit of a human-timed cue, which is a natural phrase boundary. */
  cueStart: boolean;
  /** Part of a speaker label such as "PROFESSOR:"; kept in the text but not analysed as content. */
  label?: boolean;
}

/** A speaker label at the start of a caption: one to four capitalised words followed by a colon. */
const SPEAKER_LABEL = /^((?:[A-Z][A-Z0-9.'-]*)(?:\s[A-Z][A-Z0-9.'-]*){0,3}):(?=\s)/;

const SOUND_WORDS =
  'music|applause|laughter|laughs|laughing|cheering|cheers|silence|inaudible|crosstalk|sighs|gasps|clapping|coughs|chuckles|foreign';
const PAREN_SOUND = new RegExp(String.raw`\([^)]{0,30}\b(?:${SOUND_WORDS})\b[^)]{0,30}\)`, 'gi');

/** Remove annotations that are not speech: [Music], (applause), ♪, speaker-change arrows. */
export function stripNonSpeech(text: string): string {
  return text
    .replace(/\[[^\]]{0,40}\]/g, ' ')
    .replace(PAREN_SOUND, ' ')
    .replace(/[♪♫♬♩]+/g, ' ')
    .replace(/>>+/g, ' ')
    .replace(/^\s*-\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TERMINATOR = /[.!?…。！？।॥]/;
const SENTENCE_END = /^(.*?)([.!?…。！？।॥]+)(["'”’»)\]]*)$/u;

/** Abbreviations that never end a sentence. */
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'gen', 'col', 'lt', 'sgt', 'capt', 'rev', 'gov', 'sen', 'rep', 'fig', 'no', 'vol']);
/** Abbreviations that end a sentence only when a capitalised word follows. */
const ABBREVIATIONS = new Set(['etc', 'e.g', 'i.e', 'inc', 'ltd', 'co', 'corp', 'approx', 'dept', 'est', 'a.m', 'p.m', 'u.s', 'u.k', 'ph.d']);

const startsLowercase = (word: string) => /^[^\p{L}\p{N}]*\p{Ll}/u.test(word);
const startsUppercase = (word: string) => /^[^\p{L}\p{N}]*\p{Lu}/u.test(word);

/** Decide whether `word` closes a sentence, given the word that follows it. */
export function endsSentence(word: string, next: string | undefined): boolean {
  const match = SENTENCE_END.exec(word);
  if (!match) return false;
  if (next === undefined) return true;

  const [, core, punctuation] = match;
  if (/[!?。！？।॥]/.test(punctuation)) return true;

  const bare = core.toLowerCase().replace(/^[("'“‘[]+/, '');
  if (TITLES.has(bare)) return false;
  if (/^\p{Lu}$/u.test(core)) return false; // an initial: "J. K. Rowling"
  if (/^\d+$/.test(core) && startsLowercase(next)) return false;
  if (ABBREVIATIONS.has(bare) || /^(?:\p{L}\.)+\p{L}$/u.test(core)) return startsUppercase(next);
  // A full stop followed by a lowercase word is almost always an abbreviation or a caption typo.
  return !startsLowercase(next);
}

const words = (list: string) => new Set(list.split(' '));

/** English cues for splitting unpunctuated speech into sentence-like chunks. */
const ENGLISH_BREAKS = {
  /** Words that usually open a new thought. */
  openers: words("so now but and okay ok alright well then however also next finally anyway let's because"),
  /** Words that often start a clause. */
  clauseStarts: words("if when while since although where which what how why it's that's there's here's we i they we're i'm you're they're we'll i'll you'll"),
  /** Words that need something after them, so a chunk should not end on one. */
  needsComplement: words(
    "to the a an of in on at for with and or but is are was were be been that this your my our their its his her as by from into than if so because can will would should could it's i'm we're you're very really just",
  ),
};

function toUnits(cues: RawCue[], tokenizer: Tokenizer): Unit[] {
  const units: Unit[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];

    if (cue.words && tokenizer.usesSpaces) {
      for (const word of cue.words) {
        for (const piece of stripNonSpeech(word.text).split(' ')) {
          if (piece) units.push({ text: piece, time: word.time, weight: 1, cueStart: false });
        }
      }
      continue;
    }

    const text = stripNonSpeech(cue.text);
    if (!text) continue;
    const nextStart = cues[i + 1]?.start;
    const untilNext = nextStart !== undefined && nextStart > cue.start ? nextStart - cue.start : Infinity;
    const span = Math.max(0, Math.min(cue.duration || untilNext, untilNext));
    const spanSeconds = Number.isFinite(span) ? span : 0;

    // Scripts without spaces: keep each cue (split at sentence marks) as one unit.
    const pieces = tokenizer.usesSpaces ? text.split(' ') : text.split(/(?<=[。！？])/u).map((p) => p.trim());
    const filled = pieces.filter(Boolean);
    const labelWords = tokenizer.usesSpaces ? (SPEAKER_LABEL.exec(text)?.[1].split(' ').length ?? 0) : 0;
    filled.forEach((piece, index) => {
      units.push({
        text: piece,
        time: cue.start + (spanSeconds * index) / filled.length,
        weight: tokenizer.usesSpaces ? 1 : Math.max(1, tokenizer.tokenize(piece).length),
        cueStart: index === 0,
        ...(index < labelWords ? { label: true } : {}),
      });
    });
  }
  return units;
}

function isPunctuated(units: Unit[]): boolean {
  let ends = 0;
  let words = 0;
  for (const unit of units) {
    words += unit.weight;
    if (TERMINATOR.test(unit.text.slice(-3)) && SENTENCE_END.test(unit.text)) ends++;
  }
  // Natural speech has a sentence boundary every ~15–25 words; require at least one per 45.
  return ends >= 2 && ends / Math.max(1, words) >= 1 / 45;
}

/** Group units into sentences at punctuation, with guards against run-on sentences. */
function splitPunctuated(units: Unit[]): Unit[][] {
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let weight = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const next = units[i + 1];
    current.push(unit);
    weight += unit.weight;
    if (!next) break;

    const numberedListMarker = current.length === 1 && /^\d+\.$/.test(unit.text);
    const closes = !numberedListMarker && endsSentence(unit.text, next.text);
    const runOn = weight >= 80 || (weight >= 45 && /[,;:]$/.test(unit.text));
    const longSilence = weight >= 8 && next.time - unit.time >= 4;
    if (closes || runOn || longSilence) {
      groups.push(current);
      current = [];
      weight = 0;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Group unpunctuated speech into sentence-sized chunks. A long pause always
 * ends a chunk. Otherwise every possible break between MIN and HARD words is
 * scored — longer pauses, words that open a new thought and caption
 * boundaries score well; breaking after a word that needs a complement
 * scores badly — and the best one is taken.
 */
function splitUnpunctuated(units: Unit[], language: string): Unit[][] {
  const MIN = 10;
  const IDEAL = 20;
  const HARD = 32;
  const LONG_PAUSE = 1.8;
  const english = language === 'en';
  const groups: Unit[][] = [];

  let start = 0;
  while (start < units.length) {
    let weight = 0;
    let breakAt = units.length;
    let bestScore = -Infinity;
    let reachedLimit = false;

    for (let j = start; j < units.length; j++) {
      if (j > start) {
        const gap = units[j].time - units[j - 1].time;
        if (gap >= LONG_PAUSE && weight >= 4) {
          breakAt = j;
          reachedLimit = true;
          break;
        }
        if (weight >= MIN) {
          let score = Math.min(gap, 1.5) / 1.5;
          if (units[j].cueStart) score += 0.25;
          if (english) {
            const next = units[j].text.toLowerCase();
            const previous = units[j - 1].text.toLowerCase();
            if (ENGLISH_BREAKS.openers.has(next)) score += 0.6;
            else if (ENGLISH_BREAKS.clauseStarts.has(next)) score += 0.3;
            if (ENGLISH_BREAKS.needsComplement.has(previous)) score -= 0.5;
          }
          score -= (0.2 * Math.abs(weight - IDEAL)) / IDEAL;
          if (score > bestScore) {
            bestScore = score;
            breakAt = j;
          }
        }
        if (weight >= HARD) {
          reachedLimit = true;
          break;
        }
      }
      weight += units[j].weight;
    }

    // What is left fits in one chunk: keep it whole rather than leave a fragment.
    if (!reachedLimit) breakAt = units.length;
    groups.push(units.slice(start, breakAt));
    start = breakAt;
  }
  return groups;
}

/**
 * Convert caption cues into sentences with timestamps. Punctuated captions
 * are split at sentence boundaries; unpunctuated ones (older auto-generated
 * tracks) are split into sentence-sized chunks using pauses in the speech.
 */
export function buildSentences(cues: RawCue[], tokenizer: Tokenizer, endOfSpeech: number): SentenceSet {
  const units = toUnits(cues, tokenizer);
  const punctuated = isPunctuated(units);
  if (!punctuated && tokenizer.language === 'en') {
    // Older auto-captions are all lower case; restore the one capital that is unambiguous.
    for (const unit of units) {
      if (unit.text === 'i') unit.text = 'I';
      else if (unit.text.startsWith("i'")) unit.text = `I${unit.text.slice(1)}`;
    }
  }
  const groups = punctuated ? splitPunctuated(units) : splitUnpunctuated(units, tokenizer.language);

  const sentences: Sentence[] = [];
  let previousLastTime: number | null = null;
  for (const group of groups) {
    const text = group.map((unit) => unit.text).join(' ');
    const tokens = tokenizer.tokenize(text);
    if (tokens.length === 0) continue; // punctuation-only fragments

    // Speaker labels stay readable in the text but must not become keywords.
    if (group.some((unit) => unit.label)) {
      let offset = 0;
      for (const unit of group) {
        const end = offset + unit.text.length;
        if (unit.label) {
          for (const token of tokens) {
            if (token.start >= offset && token.start < end) {
              token.content = false;
              token.stem = token.norm;
            }
          }
        }
        offset = end + 1;
      }
    }
    const start = group[0].time;
    sentences.push({
      index: sentences.length,
      text,
      start,
      end: start,
      wordCount: tokenizer.usesSpaces ? group.length : tokens.length,
      tokens,
      stems: tokens.filter((t) => t.content).map((t) => t.stem),
      gapBefore: previousLastTime === null ? 0 : Math.max(0, start - previousLastTime),
    });
    previousLastTime = group[group.length - 1].time;
  }

  for (let i = 0; i < sentences.length; i++) {
    const next = sentences[i + 1];
    sentences[i].end = next ? next.start : Math.max(sentences[i].start, endOfSpeech);
  }
  return { sentences, punctuated };
}

/** Format a sentence for display in a summary: capitalised and closed with punctuation. */
export function presentSentence(text: string): string {
  let out = text.trim().replace(/^[-–—,;:\s]+/, '');
  if (!out) return out;
  const first = out.codePointAt(0)!;
  const head = String.fromCodePoint(first);
  out = head.toUpperCase() + out.slice(head.length);
  // Only Latin-script text gets a synthetic full stop; other scripts keep their own conventions.
  if (/[\p{Script=Latin}\d]["'”’)\]]*$/u.test(out)) out += '.';
  else out = out.replace(/[,;:]$/, '.');
  return out;
}
