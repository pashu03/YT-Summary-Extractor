import { AppError } from '../errors.js';
import type { Cue, Keyword, Paragraph, SectionSummary, TimedText, TranscriptStats } from '../types.js';
import type { RawCue } from '../youtube/captions.js';
import type { Chapter } from '../youtube/metadata.js';
import { analyseKeywords, type KeywordAnalysis } from './keywords.js';
import { segmentByChapters, segmentByTopic } from './segmenter.js';
import { buildSentences, presentSentence, type Sentence } from './sentences.js';
import { textRank } from './textrank.js';
import { buildTfIdf, centroid, cosine, type SparseVector } from './tfidf.js';
import { createTokenizer } from './tokenize.js';
import { buildParagraphs, normaliseCues, round2 } from './transcript.js';

export interface AnalysisInput {
  cues: RawCue[];
  languageCode: string;
  title: string;
  durationSeconds: number;
  chapters: Chapter[];
}

export interface Analysis {
  cues: Cue[];
  paragraphs: Paragraph[];
  summary: { short: TimedText[]; takeaways: TimedText[]; sections: SectionSummary[] };
  keywords: Keyword[];
  stats: Omit<TranscriptStats, 'processingMs'>;
}

/** Average adult silent-reading speed, used for the reading-time estimate. */
const READING_WPM = 230;

/** Channel housekeeping that is never a useful summary sentence. */
const BOILERPLATE =
  /\b(subscrib\w*|like button|hit the bell|notification bell|sponsor\w*|patreon|links? (?:is |are )?in the description|description below|thanks for watching|thank you (?:so much )?for watching|see you (?:guys )?(?:in the )?next|welcome back|don't forget to|leave a comment|comments? (?:section )?below|follow me on|merch|discount code|promo code|use code|free trial|affiliate|smash that)\b/i;
const DANGLING_OPENER = /^(?:and|but|so|or|because|which|then|also|however|though|although|yet)\b/i;
const VAGUE_SUBJECT = /^(?:this|that|it|they|he|she|these|those|there|here)\b/i;

function lengthFactor(words: number): number {
  if (words < 6) return 0;
  if (words < 10) return 0.65;
  if (words <= 42) return 1;
  if (words <= 60) return 0.8;
  return 0.55;
}

/**
 * Score every sentence for how well it would stand in a summary. The core
 * signal is TextRank centrality; keyword density, overlap with the video
 * title and position add to it, and penalties remove sentences that read
 * badly on their own.
 */
function scoreSentences(
  sentences: Sentence[],
  centrality: number[],
  keywords: KeywordAnalysis,
  titleStems: Set<string>,
  punctuated: boolean,
): number[] {
  const total = sentences.length;

  const density = sentences.map((sentence) => {
    const unique = new Set(sentence.stems);
    let sum = 0;
    for (const stem of unique) sum += keywords.wordScores.get(stem) ?? 0;
    return sum / Math.sqrt(Math.max(unique.size, 4));
  });
  const maxDensity = Math.max(...density, 1e-9);

  const scores = sentences.map((sentence, i) => {
    let titleOverlap = 0;
    if (titleStems.size > 0) {
      const hits = new Set(sentence.stems.filter((stem) => titleStems.has(stem))).size;
      titleOverlap = Math.min(1, hits / Math.min(titleStems.size, 4));
    }

    let score = 0.6 * centrality[i] + 0.25 * (density[i] / maxDensity) + 0.15 * titleOverlap;

    // Openings state the topic and endings restate it.
    const position = total > 1 ? i / (total - 1) : 0;
    if (position < 0.08) score *= 1 + 0.12 * (1 - position / 0.08);
    else if (position > 0.94) score *= 1.06;

    score *= lengthFactor(sentence.wordCount);
    if (BOILERPLATE.test(sentence.text)) score *= 0.2;
    if (sentence.text.trimEnd().endsWith('?')) score *= 0.6;
    if (punctuated) {
      if (DANGLING_OPENER.test(sentence.text)) score *= 0.85;
      else if (VAGUE_SUBJECT.test(sentence.text)) score *= 0.9;
    }
    return score;
  });

  // Very short transcripts (songs, Shorts) may have no sentence long enough; fall back to centrality.
  if (scores.every((score) => score === 0)) {
    return sentences.map((sentence, i) => (sentence.wordCount >= 3 ? centrality[i] * 0.6 + 0.01 : 0));
  }
  return scores;
}

interface SelectOptions {
  /** Balance between relevance (1) and diversity (0). */
  lambda: number;
  /** Sentences already shown elsewhere; new picks are kept dissimilar from them. */
  avoid?: number[];
  /** Return false to veto a candidate, e.g. to cap picks per section. */
  allow?: (index: number) => boolean;
  onPick?: (index: number) => void;
}

/**
 * Maximal Marginal Relevance: repeatedly pick the sentence that is most
 * relevant while least similar to what has already been picked, so a summary
 * does not say the same thing twice. Result is in transcript order.
 */
function selectDiverse(
  pool: number[],
  count: number,
  scores: number[],
  vectors: SparseVector[],
  options: SelectOptions,
): number[] {
  const { lambda, avoid = [], allow, onPick } = options;
  const candidates = pool
    .filter((i) => scores[i] > 0 && !avoid.includes(i))
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, 200);
  if (candidates.length === 0) return [];

  const top = scores[candidates[0]];
  const redundancy = new Map<number, number>();
  for (const i of candidates) {
    let max = 0;
    for (const other of avoid) max = Math.max(max, cosine(vectors[i], vectors[other]));
    redundancy.set(i, max);
  }

  const chosen: number[] = [];
  const taken = new Set<number>();
  while (chosen.length < count) {
    let best = -1;
    let bestValue = -Infinity;
    for (const i of candidates) {
      if (taken.has(i)) continue;
      const overlap = redundancy.get(i)!;
      if (overlap > 0.8) continue; // near-duplicate, e.g. a repeated line
      if (allow && !allow(i)) continue;
      const value = lambda * (scores[i] / top) - (1 - lambda) * overlap;
      if (value > bestValue) {
        best = i;
        bestValue = value;
      }
    }
    if (best < 0) break;
    chosen.push(best);
    taken.add(best);
    onPick?.(best);
    for (const i of candidates) {
      if (!taken.has(i)) redundancy.set(i, Math.max(redundancy.get(i)!, cosine(vectors[i], vectors[best])));
    }
  }
  return chosen.sort((a, b) => a - b);
}

const titleCase = (term: string) =>
  term
    .split(' ')
    .map((word) => (/\p{Lu}/u.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

interface SectionRange {
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * Name each section after the terms that set it apart: words and phrases are
 * weighted by how often they occur in the section and how few other sections
 * mention them (TF-IDF with sections as the documents).
 */
function labelSections(
  ranges: SectionRange[],
  sentences: Sentence[],
  keywords: KeywordAnalysis,
): { title: string; keywords: string[] }[] {
  const phraseByKey = new Map(keywords.phrases.map((phrase) => [phrase.key, phrase]));

  const perSection = ranges.map(({ from, to }) => {
    const words = new Map<string, number>();
    const phrases = new Map<string, number>();
    let contentTokens = 0;
    for (let i = from; i < to; i++) {
      const stems = sentences[i].stems;
      contentTokens += stems.length;
      for (let at = 0; at < stems.length; at++) {
        words.set(stems[at], (words.get(stems[at]) ?? 0) + 1);
        for (let size = 2; size <= 3 && at + size <= stems.length; size++) {
          const key = stems.slice(at, at + size).join(' ');
          if (phraseByKey.has(key)) phrases.set(key, (phrases.get(key) ?? 0) + 1);
        }
      }
    }
    return { words, phrases, contentTokens };
  });

  const sectionFrequency = new Map<string, number>();
  for (const { words, phrases } of perSection) {
    for (const key of [...words.keys(), ...phrases.keys()]) {
      sectionFrequency.set(key, (sectionFrequency.get(key) ?? 0) + 1);
    }
  }
  const distinctiveness = (key: string) =>
    Math.log((ranges.length + 1) / ((sectionFrequency.get(key) ?? 0) + 1)) + 1;

  return perSection.map(({ words, phrases, contentTokens }, index) => {
    const minCount = contentTokens < 60 ? 1 : 2;
    const candidates: { stems: string[]; label: string; score: number }[] = [];

    for (const [stem, count] of words) {
      if (count < minCount) continue;
      const importance = keywords.wordScores.get(stem) ?? 0;
      candidates.push({
        stems: [stem],
        label: keywords.display.get(stem) ?? stem,
        score: count * distinctiveness(stem) * (0.35 + importance),
      });
    }
    for (const [key, count] of phrases) {
      if (count < minCount) continue;
      const phrase = phraseByKey.get(key)!;
      const importance = phrase.stems.reduce((sum, s) => sum + (keywords.wordScores.get(s) ?? 0), 0) / phrase.stems.length;
      candidates.push({
        stems: phrase.stems,
        label: phrase.display,
        score: count * distinctiveness(key) * (0.35 + importance) * 1.7,
      });
    }
    candidates.sort((a, b) => b.score - a.score);

    // Take the strongest terms, skipping any that repeat a word already used.
    const picked: typeof candidates = [];
    const usedStems = new Set<string>();
    for (const candidate of candidates) {
      if (picked.length >= 5) break;
      if (candidate.stems.some((stem) => usedStems.has(stem))) continue;
      picked.push(candidate);
      candidate.stems.forEach((stem) => usedStems.add(stem));
    }

    const topScore = picked[0]?.score ?? 0;
    const titleTerms = picked.filter((c, i) => i < 3 && c.score >= topScore * 0.4).map((c) => titleCase(c.label));
    return {
      title: titleTerms.length > 0 ? joinLabels(titleTerms) : `Part ${index + 1}`,
      keywords: picked.map((c) => c.label),
    };
  });
}

const shortSummarySize = (words: number) => (words < 250 ? 2 : words < 800 ? 3 : words < 2500 ? 4 : 5);
const takeawayCount = (words: number) => (words < 400 ? 3 : words < 1500 ? 5 : words < 5000 ? 6 : 8);

/**
 * The whole text pipeline: captions → sentences → keywords, topic sections,
 * ranked sentences → summaries. Everything is extractive and statistical;
 * every sentence in the output is taken from the transcript.
 */
export function analyseTranscript(input: AnalysisInput): Analysis {
  const cues = normaliseCues(input.cues);
  const tokenizer = createTokenizer(input.languageCode);
  const endOfSpeech = cues.length > 0 ? cues[cues.length - 1].end : 0;

  const { sentences, punctuated } = buildSentences(input.cues, tokenizer, endOfSpeech);
  if (sentences.length === 0) throw new AppError('EMPTY_TRANSCRIPT');

  const duration = input.durationSeconds > 0 ? input.durationSeconds : endOfSpeech;
  const totalWords = sentences.reduce((sum, s) => sum + s.wordCount, 0);
  const titleStems = new Set(
    tokenizer
      .tokenize(input.title)
      .filter((token) => token.content)
      .map((token) => token.stem),
  );

  /* ---- Keywords ---- */
  const stemOf = (word: string) => tokenizer.tokenize(word)[0]?.stem ?? word;
  const keywords = analyseKeywords(sentences, { language: tokenizer.language, titleStems, stem: stemOf });

  /* ---- Sentence ranking ---- */
  const { vectors } = buildTfIdf(sentences.map((s) => s.stems));
  const centrality = textRank(vectors);
  const scores = scoreSentences(sentences, centrality, keywords, titleStems, punctuated);

  /* ---- Sections ---- */
  const useChapters = input.chapters.length >= 3;
  const chaptered = useChapters ? segmentByChapters(sentences, input.chapters.map((c) => c.start)) : null;
  // Chapters that cover almost no speech are not a useful structure; fall back to detection.
  const chaptersUsable = chaptered !== null && chaptered.boundaries.length >= 2;
  const boundaries = chaptersUsable ? chaptered.boundaries : segmentByTopic(sentences, duration);

  const ranges: SectionRange[] = boundaries.map((from, i) => ({ from, to: boundaries[i + 1] ?? sentences.length }));
  const sectionOf = new Array<number>(sentences.length);
  ranges.forEach(({ from, to }, section) => {
    for (let i = from; i < to; i++) sectionOf[i] = section;
  });
  const labels = labelSections(ranges, sentences, keywords);

  const toTimed = (index: number): TimedText => ({
    text: presentSentence(sentences[index].text),
    start: round2(sentences[index].start),
  });
  const all = sentences.map((s) => s.index);

  /* ---- Short summary ---- */
  const shortIndices = selectDiverse(all, shortSummarySize(totalWords), scores, vectors, { lambda: 0.72 });

  /* ---- Key takeaways: spread across the video, distinct from the short summary ---- */
  const wanted = takeawayCount(totalWords);
  const perSectionCap = Math.ceil(wanted / ranges.length) + 1;
  const picksPerSection = new Map<number, number>();
  const takeawayIndices = selectDiverse(all, wanted, scores, vectors, {
    lambda: 0.6,
    avoid: shortIndices,
    allow: (i) => (picksPerSection.get(sectionOf[i]) ?? 0) < perSectionCap,
    onPick: (i) => picksPerSection.set(sectionOf[i], (picksPerSection.get(sectionOf[i]) ?? 0) + 1),
  });

  /* ---- Detailed summary: the most representative sentences of each section ---- */
  const maxScore = Math.max(...scores, 1e-9);
  const detailed = new Set<number>();
  const sections: SectionSummary[] = ranges.map(({ from, to }, index) => {
    const members = all.slice(from, to);
    const centre = centroid(members.map((i) => vectors[i]));
    const local = [...scores];
    for (const i of members) {
      // Blend overall importance with how typical the sentence is of its own section.
      local[i] = scores[i] > 0 ? 0.7 * (scores[i] / maxScore) + 0.3 * cosine(vectors[i], centre) : 0;
    }
    const size = Math.max(2, Math.min(ranges.length === 1 ? 6 : 5, Math.round(members.length * 0.15)));
    const ranked = selectDiverse(members, size, local, vectors, { lambda: 0.7 });
    // Drop filler (sign-offs, sponsor reads) unless it is all the section has to offer.
    const strong = ranked.filter((i) => scores[i] >= 0.12 * maxScore);
    const points = strong.length > 0 ? strong : ranked.slice(0, 1);
    points.forEach((i) => detailed.add(i));

    const words = members.reduce((sum, i) => sum + sentences[i].wordCount, 0);
    const chapter = chaptersUsable ? input.chapters[chaptered.chapterOf[index]] : undefined;
    return {
      index,
      title: chapter?.title ?? (ranges.length === 1 ? 'Full video' : labels[index].title),
      start: round2(chapter ? chapter.start : sentences[from].start),
      end: round2(sentences[to - 1].end),
      source: chapter ? 'chapter' : 'auto',
      keywords: labels[index].keywords,
      points: points.map(toTimed),
      wordCount: words,
      share: totalWords > 0 ? Math.round((words / totalWords) * 1000) / 1000 : 0,
    };
  });

  /* ---- Stats ---- */
  const summaryWordCount = [...detailed].reduce((sum, i) => sum + sentences[i].wordCount, 0);
  const speechSeconds = Math.max(1, sentences[sentences.length - 1].end - sentences[0].start);

  return {
    cues,
    paragraphs: buildParagraphs(sentences, sectionOf, punctuated),
    summary: { short: shortIndices.map(toTimed), takeaways: takeawayIndices.map(toTimed), sections },
    keywords: keywords.keywords,
    stats: {
      wordCount: totalWords,
      sentenceCount: sentences.length,
      cueCount: cues.length,
      sectionCount: sections.length,
      readingMinutes: Math.round((totalWords / READING_WPM) * 10) / 10,
      speakingRateWpm: Math.round(totalWords / (speechSeconds / 60)),
      summaryWordCount,
      compression: totalWords > 0 ? Math.round((summaryWordCount / totalWords) * 1000) / 1000 : 0,
      punctuated,
    },
  };
}
