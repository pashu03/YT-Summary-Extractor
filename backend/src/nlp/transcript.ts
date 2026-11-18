import type { Cue, Paragraph } from '../types.js';
import type { RawCue } from '../youtube/captions.js';
import type { Sentence } from './sentences.js';

export const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Turn raw caption cues into display cues with non-overlapping times.
 * Auto-generated captions use a rolling two-line display, so each cue's
 * nominal duration runs into the next one; ends are clamped to the next start.
 */
export function normaliseCues(raw: RawCue[]): Cue[] {
  const cues: Cue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cue = raw[i];
    const previous = cues[cues.length - 1];
    if (previous && previous.text === cue.text && cue.start - previous.end < 0.5) {
      // The same line repeated back-to-back: extend the earlier cue instead of duplicating it.
      previous.end = round2(Math.max(previous.end, cue.start + cue.duration));
      continue;
    }
    const nextStart = raw[i + 1]?.start;
    let end = cue.duration > 0 ? cue.start + cue.duration : (nextStart ?? cue.start + 2);
    if (nextStart !== undefined && nextStart > cue.start && end > nextStart) end = nextStart;
    if (end <= cue.start) end = cue.start + 0.5;
    cues.push({ start: round2(cue.start), end: round2(end), text: cue.text });
  }
  return cues;
}

const capitalise = (text: string) => {
  const head = String.fromCodePoint(text.codePointAt(0) ?? 32);
  return head.toUpperCase() + text.slice(head.length);
};

/**
 * Group sentences into readable paragraphs of roughly 80 words. A paragraph
 * never spans two sections, and a clear pause in speech starts a new one.
 */
export function buildParagraphs(sentences: Sentence[], sectionOf: number[], punctuated: boolean): Paragraph[] {
  const TARGET_WORDS = 80;
  const paragraphs: Paragraph[] = [];
  let current: Sentence[] = [];
  let words = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((s) => s.text).join(' ');
    paragraphs.push({
      start: round2(current[0].start),
      end: round2(current[current.length - 1].end),
      text: punctuated ? text : capitalise(text),
      sectionIndex: sectionOf[current[0].index],
    });
    current = [];
    words = 0;
  };

  for (const sentence of sentences) {
    if (current.length > 0) {
      const newSection = sectionOf[sentence.index] !== sectionOf[current[0].index];
      const pause = sentence.gapBefore >= 2.5 && words >= 30;
      if (newSection || pause || words >= TARGET_WORDS) flush();
    }
    current.push(sentence);
    words += sentence.wordCount;
  }
  flush();
  return paragraphs;
}
