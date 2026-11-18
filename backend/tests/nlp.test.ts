import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { analyseTranscript } from '../src/nlp/analyze.js';
import { segmentByChapters, targetSectionCount } from '../src/nlp/segmenter.js';
import { buildSentences, endsSentence, presentSentence, stripNonSpeech } from '../src/nlp/sentences.js';
import { getStopwords, primaryLanguage } from '../src/nlp/stopwords.js';
import { buildSimilarityGraph, pageRank, textRank } from '../src/nlp/textrank.js';
import { buildTfIdf, cosine } from '../src/nlp/tfidf.js';
import { createTokenizer } from '../src/nlp/tokenize.js';
import { normaliseCues } from '../src/nlp/transcript.js';
import type { RawCue } from '../src/youtube/captions.js';

/** Build human-style cues: one line of text every `step` seconds. */
function cuesFrom(lines: string[], step = 4): RawCue[] {
  return lines.map((text, i) => ({ start: i * step, duration: step - 0.2, text }));
}

/** Build auto-caption-style cues with a timestamp on every word. */
function wordCues(text: string, secondsPerWord = 0.35, pauses: Record<number, number> = {}): RawCue[] {
  const all = text.split(' ');
  const cues: RawCue[] = [];
  let time = 0;
  for (let i = 0; i < all.length; i += 6) {
    const words = all.slice(i, i + 6).map((word, k) => {
      time += secondsPerWord + (pauses[i + k] ?? 0);
      return { text: word, time };
    });
    cues.push({ start: words[0].time, duration: 4, text: words.map((w) => w.text).join(' '), words });
  }
  return cues;
}

describe('tokenizer', () => {
  it('flags stopwords, numbers and possessives and stems English', () => {
    const tokens = createTokenizer('en').tokenize("The network's layers are learning 784 weights, don't they?");
    const content = tokens.filter((t) => t.content).map((t) => t.stem);
    expect(content).toEqual(['network', 'layer', 'learn', 'weight']);
    expect(tokens.find((t) => t.raw === "network's")?.norm).toBe('network');
  });

  it('keeps Devanagari words whole, including their vowel signs', () => {
    const tokens = createTokenizer('hi').tokenize('न्यूरॉन की सक्रियता बहुत महत्वपूर्ण है');
    expect(tokens.map((t) => t.raw)).toEqual(['न्यूरॉन', 'की', 'सक्रियता', 'बहुत', 'महत्वपूर्ण', 'है']);
    expect(tokens.filter((t) => t.content).map((t) => t.raw)).toEqual(['न्यूरॉन', 'सक्रियता', 'महत्वपूर्ण']);
  });

  it('segments scripts written without spaces', () => {
    const tokenizer = createTokenizer('ja');
    expect(tokenizer.usesSpaces).toBe(false);
    expect(tokenizer.tokenize('ニューラルネットワークは数字を認識します').length).toBeGreaterThan(3);
  });

  it('normalises language codes', () => {
    expect(primaryLanguage('pt-BR')).toBe('pt');
    expect(primaryLanguage('iw')).toBe('he');
    expect(getStopwords('en-US').has('the')).toBe(true);
    expect(getStopwords('en').has('computer')).toBe(false);
    expect(getStopwords('xx').size).toBe(0);
  });
});

describe('sentence boundaries', () => {
  it.each([
    ['done.', 'Next', true],
    ['done.', 'next', false],
    ['really?', 'yes', true],
    ['Dr.', 'Smith', false],
    ['J.', 'Rowling', false],
    ['etc.', 'Then', true],
    ['etc.', 'and', false],
    ['U.S.', 'Army', true],
    ['3.5', 'percent', false],
    ['2013.', 'It', true],
    ['said."', 'Then', true],
    ['है।', 'यह', true],
    ['end.', undefined, true],
    ['word', 'Next', false],
  ])('endsSentence(%j, %j) → %s', (word, next, expected) => {
    expect(endsSentence(word, next)).toBe(expected);
  });

  it('strips non-speech annotations', () => {
    expect(stripNonSpeech('[Music] hello (applause) there ♪ la ♪ >> yes [ __ ]')).toBe('hello there la yes');
    expect(stripNonSpeech('- So (as I said) we begin')).toBe('So (as I said) we begin');
    expect(stripNonSpeech('[Applause]')).toBe('');
  });

  it('formats sentences for display', () => {
    expect(presentSentence('react is a library')).toBe('React is a library.');
    expect(presentSentence('Is it done?')).toBe('Is it done?');
    expect(presentSentence('and so on,')).toBe('And so on.');
    expect(presentSentence('यह एक वाक्य है।')).toBe('यह एक वाक्य है।');
  });
});

describe('buildSentences', () => {
  const tokenizer = createTokenizer('en');

  it('splits punctuated captions at sentence ends and keeps timestamps', () => {
    const cues = cuesFrom([
      'Neural networks learn from data. They',
      'adjust weights during training. Dr. Smith',
      'explains the idea clearly. Is that',
      'really all there is? Yes it is.',
    ]);
    const { sentences, punctuated } = buildSentences(cues, tokenizer, 16);
    expect(punctuated).toBe(true);
    expect(sentences.map((s) => s.text)).toEqual([
      'Neural networks learn from data.',
      'They adjust weights during training.',
      'Dr. Smith explains the idea clearly.',
      'Is that really all there is?',
      'Yes it is.',
    ]);
    expect(sentences[0].start).toBe(0);
    expect(sentences[1].start).toBeGreaterThan(2);
    expect(sentences[1].start).toBeLessThan(4);
    expect(sentences[4].end).toBe(16);
    // Each sentence ends where the next begins.
    sentences.slice(0, -1).forEach((s, i) => expect(s.end).toBe(sentences[i + 1].start));
  });

  it('breaks unpunctuated speech at pauses and never inside the hard limit', () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const { sentences, punctuated } = buildSentences(wordCues(text, 0.35, { 25: 2.5 }), tokenizer, 60);
    expect(punctuated).toBe(false);
    expect(sentences.every((s) => s.wordCount <= 33)).toBe(true);
    // The 2.5 s pause before word25 must start a new sentence.
    expect(sentences.some((s) => s.text.startsWith('word25 '))).toBe(true);
    expect(sentences.reduce((sum, s) => sum + s.wordCount, 0)).toBe(120);
  });

  it('prefers to break before words that open a new thought', () => {
    // 35 evenly spaced words with no pauses: too long for one chunk, so a break must be chosen.
    const text =
      'react is a javascript library for building interactive user interfaces that was developed and released by facebook engineers so we use it to build components that represent logical reusable parts of the interface in every application';
    const { sentences } = buildSentences(wordCues(text), tokenizer, 20);
    expect(sentences).toHaveLength(2);
    expect(sentences[0].text.endsWith('facebook engineers')).toBe(true);
    expect(sentences[1].text.startsWith('so we use')).toBe(true);
  });

  it('restores the capital I in lower-case auto captions', () => {
    const { sentences } = buildSentences(wordCues("today i think i'm going to show how this works for everyone watching"), tokenizer, 10);
    expect(sentences[0].text).toContain("I think I'm going");
  });

  it('keeps speaker labels in the text but out of the content words', () => {
    const cues = cuesFrom(['PATRICK WINSTON: Welcome to the course. We study', 'intelligent programs here. They solve problems.']);
    const { sentences } = buildSentences(cues, tokenizer, 8);
    expect(sentences[0].text).toBe('PATRICK WINSTON: Welcome to the course.');
    expect(sentences[0].stems).not.toContain('patrick');
    expect(sentences[0].stems).not.toContain('winston');
  });

  it('drops cues that contain no speech', () => {
    const { sentences } = buildSentences(cuesFrom(['[Music]', 'Hello there everyone. Welcome back.', '[Applause]']), tokenizer, 12);
    expect(sentences.map((s) => s.text)).toEqual(['Hello there everyone.', 'Welcome back.']);
  });
});

describe('normaliseCues', () => {
  it('clamps overlapping cues and merges immediate repeats', () => {
    const cues = normaliseCues([
      { start: 0, duration: 5, text: 'one' },
      { start: 2, duration: 5, text: 'two' },
      { start: 7.1, duration: 1, text: 'two' },
      { start: 10, duration: 0, text: 'three' },
    ]);
    expect(cues).toEqual([
      { start: 0, end: 2, text: 'one' },
      { start: 2, end: 8.1, text: 'two' },
      { start: 10, end: 12, text: 'three' },
    ]);
  });
});

describe('TF-IDF and TextRank', () => {
  const documents = [
    ['neural', 'network', 'layer'],
    ['network', 'layer', 'weight'],
    ['weight', 'bias', 'network'],
    ['banana', 'smoothie', 'recipe'],
  ];

  it('gives rarer terms a higher weight and normalises vectors', () => {
    const { vectors, idf } = buildTfIdf(documents);
    expect(idf.get('banana')!).toBeGreaterThan(idf.get('network')!);
    for (const vector of vectors) {
      const length = Math.sqrt([...vector.values()].reduce((sum, w) => sum + w * w, 0));
      expect(length).toBeCloseTo(1, 10);
    }
    expect(cosine(vectors[0], vectors[0])).toBeCloseTo(1, 10);
    expect(cosine(vectors[0], vectors[3])).toBe(0);
    expect(cosine(vectors[0], vectors[1])).toBeGreaterThan(cosine(vectors[0], vectors[2]));
  });

  it('builds a symmetric graph that only links documents sharing terms', () => {
    const graph = buildSimilarityGraph(buildTfIdf(documents).vectors);
    expect(graph.neighbours[3]).toEqual([]);
    expect(graph.neighbours[0].sort()).toEqual([1, 2]);
    graph.neighbours.forEach((list, i) => list.forEach((j) => expect(graph.neighbours[j]).toContain(i)));
  });

  it('ranks the most connected sentence highest and the outlier lowest', () => {
    const scores = textRank(buildTfIdf(documents).vectors);
    expect(Math.max(...scores)).toBe(1);
    expect(scores.indexOf(1)).toBe(1);
    expect(scores[3]).toBe(Math.min(...scores));
  });

  it('pageRank handles empty and edgeless graphs', () => {
    expect(pageRank({ neighbours: [], weights: [] })).toEqual([]);
    expect(pageRank({ neighbours: [[], []], weights: [[], []] })).toEqual([1, 1]);
  });
});

describe('segmentation helpers', () => {
  it('scales the number of sections with length', () => {
    expect(targetSectionCount(90, 40)).toBe(1);
    expect(targetSectionCount(600, 8)).toBe(1);
    expect(targetSectionCount(600, 120)).toBe(5);
    expect(targetSectionCount(3600, 700)).toBe(12);
    expect(targetSectionCount(6 * 3600, 5000)).toBe(16);
  });

  it('maps chapters to sentences and skips chapters without speech', () => {
    const tokenizer = createTokenizer('en');
    const cues = cuesFrom(['First part here. More first.', 'Second part now. More second.', 'Third part last. More third.'], 10);
    const { sentences } = buildSentences(cues, tokenizer, 30);
    // The chapter starting at 17 s ends at 20 s, before anything is said in it.
    const { boundaries, chapterOf } = segmentByChapters(sentences, [0, 10, 17, 20]);
    expect(boundaries).toEqual([0, 2, 4]);
    expect(chapterOf).toEqual([0, 1, 3]);
  });
});

/** A small lecture with three clearly different topics, repeated enough to give the statistics something to find. */
function lecture(): RawCue[] {
  const topics = [
    [
      'Neural networks are built from layers of connected neurons.',
      'Each neuron in a neural network holds an activation value.',
      'The weights between layers decide how activations flow through the network.',
      'Training a neural network means adjusting those weights.',
      'A hidden layer in the network detects simple patterns such as edges.',
      'Deeper layers of the neural network combine edges into shapes.',
    ],
    [
      'Gradient descent is the algorithm that finds good weights.',
      'The algorithm measures the error with a cost function.',
      'Gradient descent moves each weight downhill on the cost function.',
      'The learning rate controls how large each downhill step is.',
      'A learning rate that is too large makes gradient descent unstable.',
      'With a small learning rate the cost function decreases slowly but steadily.',
    ],
    [
      'Sourdough bread starts with a starter made of flour and water.',
      'The starter contains wild yeast that makes the bread dough rise.',
      'Knead the bread dough until the gluten becomes elastic.',
      'Let the dough rest overnight so the yeast can ferment the flour.',
      'Bake the sourdough bread in a hot oven with plenty of steam.',
      'A good sourdough loaf has a crisp crust and an open crumb.',
    ],
  ];
  const lines: string[] = [];
  for (const topic of topics) for (let repeat = 0; repeat < 3; repeat++) lines.push(...topic);
  return cuesFrom(lines, 5);
}

describe('analyseTranscript', () => {
  const input = {
    cues: lecture(),
    languageCode: 'en',
    title: 'Neural networks, gradient descent and sourdough',
    durationSeconds: 54 * 5,
    chapters: [],
  };
  const analysis = analyseTranscript(input);

  it('reports consistent statistics', () => {
    expect(analysis.stats.sentenceCount).toBe(54);
    expect(analysis.stats.cueCount).toBe(54);
    expect(analysis.stats.punctuated).toBe(true);
    expect(analysis.stats.wordCount).toBeGreaterThan(450);
    expect(analysis.stats.compression).toBeGreaterThan(0);
    expect(analysis.stats.compression).toBeLessThan(0.6);
    expect(analysis.stats.sectionCount).toBe(analysis.summary.sections.length);
  });

  it('extracts only sentences that appear in the transcript, in order', () => {
    const source = new Set(input.cues.map((cue) => cue.text));
    const all = [
      ...analysis.summary.short,
      ...analysis.summary.takeaways,
      ...analysis.summary.sections.flatMap((section) => section.points),
    ];
    expect(all.length).toBeGreaterThan(5);
    for (const line of all) expect(source.has(line.text)).toBe(true);
    for (const list of [analysis.summary.short, analysis.summary.takeaways]) {
      const times = list.map((line) => line.start);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('does not repeat a sentence between the short summary and the takeaways', () => {
    const short = new Set(analysis.summary.short.map((line) => line.text));
    for (const line of analysis.summary.takeaways) expect(short.has(line.text)).toBe(false);
    // The transcript repeats every sentence three times; near-duplicates must be filtered out.
    const takeaways = analysis.summary.takeaways.map((line) => line.text);
    expect(new Set(takeaways).size).toBe(takeaways.length);
  });

  it('finds the main terms, including multi-word phrases', () => {
    const terms = analysis.keywords.map((keyword) => keyword.term.toLowerCase());
    expect(terms).toEqual(expect.arrayContaining(['gradient descent', 'learning rate', 'cost function']));
    expect(terms.some((term) => term.includes('network'))).toBe(true);
    expect(terms.some((term) => term.includes('bread') || term.includes('dough'))).toBe(true);
    expect(analysis.keywords[0].score).toBe(1);
    expect(analysis.keywords.every((keyword) => keyword.score > 0 && keyword.score <= 1)).toBe(true);
    for (const stopword of ['the', 'and', 'that', 'is']) expect(terms).not.toContain(stopword);
  });

  it('detects the topic changes', () => {
    const { sections } = analysis.summary;
    expect(sections.length).toBeGreaterThanOrEqual(2);
    // Boundaries at 90 s and 180 s separate the three topics; allow one sentence of slack.
    const starts = sections.map((section) => section.start);
    expect(starts.some((start) => Math.abs(start - 90) <= 5)).toBe(true);
    expect(starts.some((start) => Math.abs(start - 180) <= 5)).toBe(true);
    const shareTotal = sections.reduce((sum, section) => sum + section.share, 0);
    expect(shareTotal).toBeCloseTo(1, 1);
    expect(sections.every((section) => section.source === 'auto' && section.title.length > 0)).toBe(true);
  });

  it('builds paragraphs that cover the whole transcript without crossing sections', () => {
    const words = analysis.paragraphs.reduce((sum, p) => sum + p.text.split(' ').length, 0);
    expect(words).toBe(analysis.stats.wordCount);
    for (const paragraph of analysis.paragraphs) {
      expect(paragraph.sectionIndex).toBeGreaterThanOrEqual(0);
      expect(paragraph.sectionIndex).toBeLessThan(analysis.summary.sections.length);
      expect(paragraph.end).toBeGreaterThanOrEqual(paragraph.start);
    }
    const order = analysis.paragraphs.map((p) => p.sectionIndex);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('uses creator chapters when they are provided', () => {
    const withChapters = analyseTranscript({
      ...input,
      chapters: [
        { start: 0, title: 'Networks' },
        { start: 90, title: 'Optimisation' },
        { start: 180, title: 'Baking' },
      ],
    });
    expect(withChapters.summary.sections.map((s) => [s.title, s.source, s.start])).toEqual([
      ['Networks', 'chapter', 0],
      ['Optimisation', 'chapter', 90],
      ['Baking', 'chapter', 180],
    ]);
    expect(withChapters.summary.sections[2].keywords.join(' ').toLowerCase()).toMatch(/bread|dough|sourdough|yeast/);
  });

  it('handles a transcript too short to rank', () => {
    const tiny = analyseTranscript({ ...input, cues: cuesFrom(['Hello world.']), durationSeconds: 4 });
    expect(tiny.stats.sentenceCount).toBe(1);
    expect(tiny.summary.sections).toHaveLength(1);
    expect(tiny.summary.sections[0].title).toBe('Full video');
    expect(tiny.paragraphs).toHaveLength(1);
  });

  it('rejects captions that contain no speech at all', () => {
    expect(() => analyseTranscript({ ...input, cues: cuesFrom(['[Music]', '[Applause]']) })).toThrowError(
      expect.objectContaining({ code: 'EMPTY_TRANSCRIPT' }) as AppError,
    );
  });

  it('stays fast on a three-hour transcript', () => {
    const base = lecture();
    const long: RawCue[] = [];
    for (let i = 0; i < 40; i++) {
      for (const cue of base) long.push({ ...cue, start: cue.start + i * 270, text: cue.text.replace(/\.$/, ` in part ${i}.`) });
    }
    const started = performance.now();
    const result = analyseTranscript({ ...input, cues: long, durationSeconds: 40 * 270 });
    expect(result.stats.sentenceCount).toBe(2160);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
