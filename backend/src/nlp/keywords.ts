import type { Keyword } from '../types.js';
import type { Sentence } from './sentences.js';
import { pageRank, type Graph } from './textrank.js';
import type { Token } from './tokenize.js';

export interface Phrase {
  /** Stems joined by a space; the identity of the phrase. */
  key: string;
  stems: string[];
  display: string;
  count: number;
  score: number;
}

export interface KeywordAnalysis {
  /** Ranked words and phrases for display. */
  keywords: Keyword[];
  /** Importance of every content word, 0–1, keyed by stem. */
  wordScores: Map<string, number>;
  wordCounts: Map<string, number>;
  /** Most common written form of each stem. */
  display: Map<string, string>;
  /** Every multi-word phrase that repeats in the transcript. */
  phrases: Phrase[];
}

/**
 * English words that pass the stopword filter but rarely name a topic. They
 * stay in the similarity model and are only down-weighted as keywords.
 */
const GENERIC_EN = new Set(
  `good great better best bad nice cool awesome amazing different new old big small large long short high low
   important interesting easy hard simple real true whole example examples time times people person year years day
   days week weeks month months hour hours minute minutes second seconds start starts started end ends number part
   parts point points case fact idea question questions answer reason reasons work works working worked need needs
   needed show shows showing call called find found feel keep run help helps happen happens happened place side
   top bottom left little bit couple half kind type types lot word words name names line level open close set add
   ready live watch watching video videos channel today tomorrow yesterday last able easy quick fast sense matter
   change changes turn move stop wait remember understand learn talk speak read write ask love hope play world life
   man woman men women kid kids friend friends home hand head eye eyes care course fine free full hear heard
   first third fourth fifth previous following particular specific certain various single entire actual basic main
   major general common similar exactly especially usually typically zero three four five six seven eight nine
   ten hundred thousand million billion`
    .split(/\s+/)
    .filter(Boolean),
);
const GENERIC_PENALTY = 0.45;

const CO_OCCURRENCE_WINDOW = 3;
const MAX_PHRASE_WORDS = 3;

interface AnalyseOptions {
  language: string;
  /** Video title; words from it get a small relevance boost. */
  titleStems: Set<string>;
  /** Stemmer for the language, used to match the generic-word list against stems. */
  stem: (word: string) => string;
  limit?: number;
}

/** Surface form used when counting how a term is written. Sentence-initial capitals are not trusted. */
function surface(token: Token, sentenceInitial: boolean): string {
  const hasInnerCapital = /\p{Lu}/u.test(token.raw.slice(1));
  const capitalised = /^\p{Lu}/u.test(token.raw);
  const raw = token.raw.replace(/['’]s$/i, '');
  if (hasInnerCapital) return raw; // acronyms and CamelCase: "API", "JavaScript"
  if (capitalised && !sentenceInitial) return raw; // proper nouns: "React"
  return token.norm;
}

function mostCommon(variants: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [variant, count] of variants) {
    if (count > bestCount) {
      best = variant;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Keyword extraction without any model: TextRank over a word co-occurrence
 * graph, blended with term frequency, plus repeated multi-word phrases found
 * as runs of adjacent content words.
 */
export function analyseKeywords(sentences: Sentence[], options: AnalyseOptions): KeywordAnalysis {
  const { language, titleStems, stem, limit = 24 } = options;
  const genericStems = language === 'en' ? new Set([...GENERIC_EN].map(stem)) : new Set<string>();

  const wordCounts = new Map<string, number>();
  const variants = new Map<string, Map<string, number>>();
  const nodeIndex = new Map<string, number>();
  const edges: Map<number, number>[] = [];
  const phraseCounts = new Map<string, { stems: string[]; count: number; variants: Map<string, number> }>();

  const nodeFor = (stemmed: string): number => {
    let index = nodeIndex.get(stemmed);
    if (index === undefined) {
      index = nodeIndex.size;
      nodeIndex.set(stemmed, index);
      edges.push(new Map());
    }
    return index;
  };
  const bump = <K>(map: Map<K, number>, key: K, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

  let totalContent = 0;
  for (const sentence of sentences) {
    const tokens = sentence.tokens;
    const content: { token: Token; position: number }[] = [];
    tokens.forEach((token, position) => {
      if (token.content) content.push({ token, position });
    });
    totalContent += content.length;

    content.forEach(({ token, position }, i) => {
      bump(wordCounts, token.stem);
      let forms = variants.get(token.stem);
      if (!forms) variants.set(token.stem, (forms = new Map()));
      bump(forms, surface(token, position === 0));

      // Link each content word to the few content words that follow it.
      const from = nodeFor(token.stem);
      for (let j = i + 1; j < content.length && j <= i + CO_OCCURRENCE_WINDOW - 1; j++) {
        const to = nodeFor(content[j].token.stem);
        if (to === from) continue;
        bump(edges[from], to);
        bump(edges[to], from);
      }
    });

    // Phrases: runs of content words that sit directly next to each other in the text.
    let run: { token: Token; position: number }[] = [];
    const flush = () => {
      for (let size = 2; size <= Math.min(MAX_PHRASE_WORDS, run.length); size++) {
        for (let at = 0; at + size <= run.length; at++) {
          const part = run.slice(at, at + size);
          const stems = part.map((p) => p.token.stem);
          if (new Set(stems).size !== stems.length) continue; // "very very", "go go"
          const key = stems.join(' ');
          let entry = phraseCounts.get(key);
          if (!entry) phraseCounts.set(key, (entry = { stems, count: 0, variants: new Map() }));
          entry.count++;
          bump(entry.variants, part.map((p) => surface(p.token, p.position === 0)).join(' '));
        }
      }
      run = [];
    };
    for (const item of content) {
      const previous = run[run.length - 1];
      const adjacent =
        previous !== undefined &&
        item.position === previous.position + 1 &&
        /^\s*$/.test(sentence.text.slice(previous.token.end, item.token.start));
      if (!adjacent) flush();
      run.push(item);
    }
    flush();
  }

  /* ---- Word scores: graph centrality blended with frequency ---- */
  const graph: Graph = {
    neighbours: edges.map((row) => [...row.keys()]),
    weights: edges.map((row) => [...row.values()]),
  };
  const centrality = pageRank(graph);
  let maxCount = 1;
  for (const count of wordCounts.values()) if (count > maxCount) maxCount = count;

  const wordScores = new Map<string, number>();
  let maxScore = 0;
  for (const [stemmed, index] of nodeIndex) {
    const frequency = Math.log(1 + wordCounts.get(stemmed)!) / Math.log(1 + maxCount);
    let score = 0.5 * centrality[index] + 0.5 * frequency;
    if (titleStems.has(stemmed)) score *= 1.25;
    if (genericStems.has(stemmed)) score *= GENERIC_PENALTY;
    wordScores.set(stemmed, score);
    if (score > maxScore) maxScore = score;
  }
  if (maxScore > 0) for (const [stemmed, score] of wordScores) wordScores.set(stemmed, score / maxScore);

  const display = new Map<string, string>();
  for (const [stemmed, forms] of variants) display.set(stemmed, mostCommon(forms));

  /* ---- Phrase scores: member importance scaled by how tightly the words stick together ---- */
  // A pair of words must recur to count as a term; longer transcripts need more evidence.
  const minPhraseCount = totalContent > 3000 ? 4 : totalContent > 500 ? 3 : 2;
  const phrases: Phrase[] = [];
  for (const [key, entry] of phraseCounts) {
    if (entry.count < minPhraseCount) continue;
    // Geometric mean: one weak member ("first layer") drags the phrase down,
    // so only phrases made entirely of meaningful words rank highly.
    const size = entry.stems.length;
    const product = entry.stems.reduce((value, s) => value * (wordScores.get(s) ?? 0), 1);
    const strength = Math.pow(product, 1 / size);
    // Cohesion: how often the words occur together relative to how often they occur at all.
    // "gradient descent" (always together) scores 1; "network detects" (a common word next to a rare one) scores low.
    const memberCounts = entry.stems.reduce((value, s) => value * (wordCounts.get(s) ?? 1), 1);
    const cohesion = Math.min(1, entry.count / Math.pow(memberCounts, 1 / size));
    phrases.push({
      key,
      stems: entry.stems,
      display: mostCommon(entry.variants),
      count: entry.count,
      score: strength * Math.sqrt(cohesion) * 1.2,
    });
  }
  phrases.sort((a, b) => b.score - a.score || b.count - a.count);

  /* ---- Merge words and phrases into one ranked list ---- */
  const minWordCount = totalContent > 150 ? 2 : 1;
  type Candidate = { kind: 'word' | 'phrase'; stems: string[]; term: string; count: number; score: number };
  const candidates: Candidate[] = [
    ...phrases.map((p): Candidate => ({ kind: 'phrase', stems: p.stems, term: p.display, count: p.count, score: p.score })),
    ...[...wordScores]
      .filter(([stemmed]) => (wordCounts.get(stemmed) ?? 0) >= minWordCount)
      .map(([stemmed, score]): Candidate => ({
        kind: 'word',
        stems: [stemmed],
        term: display.get(stemmed) ?? stemmed,
        count: wordCounts.get(stemmed) ?? 0,
        score,
      })),
  ].sort((a, b) => b.score - a.score || b.count - a.count);

  const chosen: Candidate[] = [];
  const maxPhrases = Math.ceil(limit * 0.5);
  let phraseTotal = 0;
  for (const candidate of candidates) {
    if (chosen.length >= limit) break;
    if (candidate.kind === 'phrase') {
      const key = ` ${candidate.stems.join(' ')} `;
      const related = chosen.findIndex(
        (other) => other.kind === 'phrase' && (key.includes(` ${other.stems.join(' ')} `) || ` ${other.stems.join(' ')} `.includes(key)),
      );
      if (related >= 0) {
        const other = chosen[related];
        const extendsOther = candidate.stems.length > other.stems.length;
        // "support vector machine" occurring as often as "support vector" is the real term: swap it in.
        if (extendsOther && candidate.count >= 0.8 * other.count) chosen[related] = { ...candidate, score: other.score };
        // Otherwise a longer phrase is just the chosen term plus a neighbouring word. A shorter
        // phrase is kept only if it is clearly used on its own as well.
        if (extendsOther || candidate.count <= 1.25 * other.count) continue;
      }
      if (phraseTotal >= maxPhrases) continue;
      phraseTotal++;
    } else {
      // Skip a single word that mostly appears inside an already chosen phrase.
      const absorbed = chosen.some(
        (other) => other.kind === 'phrase' && other.stems.includes(candidate.stems[0]) && other.count >= 0.6 * candidate.count,
      );
      if (absorbed) continue;
    }
    chosen.push(candidate);
  }

  const top = chosen[0]?.score ?? 1;
  const keywords: Keyword[] = chosen.map((c) => ({
    term: c.term,
    score: Math.round((c.score / (top || 1)) * 1000) / 1000,
    count: c.count,
    kind: c.kind,
  }));

  return { keywords, wordScores, wordCounts, display, phrases };
}
