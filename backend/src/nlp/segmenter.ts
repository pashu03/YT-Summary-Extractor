import type { Sentence } from './sentences.js';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** How many sections a transcript of this length should be divided into. */
export function targetSectionCount(durationSeconds: number, sentenceCount: number): number {
  const minutes = durationSeconds / 60;
  if (minutes < 2.5 || sentenceCount < 12) return 1;
  // Grows with the square root of the length: 4 min → 3, 10 min → 5, 20 min → 7, 60 min → 12.
  const byLength = Math.round(1.6 * Math.sqrt(minutes));
  return clamp(byLength, 2, Math.min(16, Math.floor(sentenceCount / 5)));
}

function blockSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (const [term, count] of left) {
    leftSquares += count * count;
    const other = right.get(term);
    if (other) dot += count * other;
  }
  for (const count of right.values()) rightSquares += count * count;
  return leftSquares && rightSquares ? dot / Math.sqrt(leftSquares * rightSquares) : 0;
}

function countTerms(sentences: Sentence[], from: number, to: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = Math.max(0, from); i < Math.min(sentences.length, to); i++) {
    for (const stem of sentences[i].stems) counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  return counts;
}

/**
 * TextTiling topic segmentation. For every gap between sentences, compare the
 * vocabulary of the block before it with the block after it; a dip in that
 * similarity marks a topic shift. The deepest dips become section boundaries.
 *
 * Returns the index of the first sentence of each section (always starting with 0).
 */
export function segmentByTopic(sentences: Sentence[], durationSeconds: number): number[] {
  const total = sentences.length;
  const target = targetSectionCount(durationSeconds, total);
  if (target <= 1) return [0];

  const blockSize = clamp(Math.round(total / target / 2), 3, 12);
  const minSentences = Math.max(4, Math.floor(total / (target * 3)));
  const minSeconds = Math.max(30, durationSeconds / (target * 3));

  // similarity[g] compares sentences [g - blockSize, g) with [g, g + blockSize).
  const similarity = new Array<number>(total).fill(1);
  for (let gap = 1; gap < total; gap++) {
    similarity[gap] = blockSimilarity(
      countTerms(sentences, gap - blockSize, gap),
      countTerms(sentences, gap, gap + blockSize),
    );
  }

  const smoothed = similarity.map((_, gap) => {
    if (gap === 0) return 1;
    let sum = 0;
    let count = 0;
    for (let k = Math.max(1, gap - 2); k <= Math.min(total - 1, gap + 2); k++) {
      sum += similarity[k];
      count++;
    }
    return sum / count;
  });

  // Depth of each valley: how far similarity climbs on both sides before falling again.
  const depth = new Array<number>(total).fill(0);
  for (let gap = minSentences; gap <= total - minSentences; gap++) {
    let leftPeak = smoothed[gap];
    for (let k = gap - 1; k >= 1 && smoothed[k] >= leftPeak; k--) leftPeak = smoothed[k];
    let rightPeak = smoothed[gap];
    for (let k = gap + 1; k < total && smoothed[k] >= rightPeak; k++) rightPeak = smoothed[k];
    depth[gap] = leftPeak + rightPeak - 2 * smoothed[gap];
    // A long silence before a sentence is independent evidence of a topic change.
    if (sentences[gap].gapBefore >= 3) depth[gap] += 0.05;
  }

  const endTime = sentences[total - 1].end;
  const boundaries: number[] = [0];
  const canPlace = (gap: number) =>
    endTime - sentences[gap].start >= minSeconds &&
    boundaries.every(
      (other) =>
        Math.abs(other - gap) >= minSentences &&
        Math.abs(sentences[other].start - sentences[gap].start) >= minSeconds,
    );

  // Pass 1: the deepest valleys anywhere in the transcript.
  const byDepth = depth
    .map((value, gap) => ({ gap, value }))
    .filter((c) => c.value > 0.01)
    .sort((a, b) => b.value - a.value);
  for (const { gap } of byDepth) {
    if (boundaries.length >= target) break;
    if (canPlace(gap)) boundaries.push(gap);
  }

  // Pass 2: a section much longer than the rest hides structure of its own.
  // Split it at its deepest internal valley, however shallow.
  const typicalSeconds = (endTime - sentences[0].start) / target;
  for (let extra = 0; extra < Math.ceil(target / 2); extra++) {
    const sorted = [...boundaries].sort((a, b) => a - b);
    let split = -1;
    let splitDepth = -1;
    sorted.forEach((from, i) => {
      const to = sorted[i + 1] ?? total;
      const seconds = (sorted[i + 1] !== undefined ? sentences[to].start : endTime) - sentences[from].start;
      if (seconds < typicalSeconds * 2.2) return;
      for (let gap = from + 1; gap < to; gap++) {
        if (depth[gap] > splitDepth && canPlace(gap)) {
          split = gap;
          splitDepth = depth[gap];
        }
      }
    });
    if (split < 0) break;
    boundaries.push(split);
  }

  return boundaries.sort((a, b) => a - b);
}

/** Section boundaries from creator-defined chapters: the first sentence starting in each chapter. */
export function segmentByChapters(sentences: Sentence[], chapterStarts: number[]): { boundaries: number[]; chapterOf: number[] } {
  const boundaries: number[] = [];
  const chapterOf: number[] = [];
  let sentence = 0;
  for (let chapter = 0; chapter < chapterStarts.length; chapter++) {
    const nextStart = chapterStarts[chapter + 1] ?? Infinity;
    // A sentence belongs to the chapter in which most of it is spoken, so allow a little lead-in.
    while (sentence < sentences.length && sentences[sentence].start < chapterStarts[chapter] - 1) sentence++;
    if (sentence >= sentences.length) break;
    if (sentences[sentence].start >= nextStart - 1) continue; // chapter with no speech
    if (boundaries[boundaries.length - 1] === sentence) continue;
    boundaries.push(sentence);
    chapterOf.push(chapter);
  }
  if (boundaries.length === 0 || boundaries[0] !== 0) {
    if (boundaries.length === 0) {
      boundaries.push(0);
      chapterOf.push(0);
    } else {
      boundaries[0] = 0;
    }
  }
  return { boundaries, chapterOf };
}
