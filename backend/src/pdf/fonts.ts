import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

export type Weight = 'regular' | 'bold';

export interface FontFace {
  /** Name the face is registered under in a PDF document. */
  name: string;
  data: Buffer;
  has(codePoint: number): boolean;
}

export interface TextRun {
  font: string;
  text: string;
}

/**
 * Font files, each written out as a literal `new URL(…, import.meta.url)`.
 * Hosting platforms that trace which files a function needs (Vercel) can only
 * find files referenced this way, so do not build these paths dynamically.
 */
const FONT_FILES: Record<string, URL> = {
  'NotoSans-Regular': new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url),
  'NotoSans-Bold': new URL('../../assets/fonts/NotoSans-Bold.ttf', import.meta.url),
  'NotoSansDevanagari-Regular': new URL('../../assets/fonts/NotoSansDevanagari-Regular.ttf', import.meta.url),
  'NotoSansDevanagari-Bold': new URL('../../assets/fonts/NotoSansDevanagari-Bold.ttf', import.meta.url),
};

/**
 * Faces in fallback order. Noto Sans covers Latin, Greek and Cyrillic; Noto
 * Sans Devanagari covers Hindi, Marathi and Nepali. To support another
 * script, drop its Noto TTF files into assets/fonts and add them here and to
 * FONT_FILES.
 */
const FAMILIES: Record<Weight, string[]> = {
  regular: ['NotoSans-Regular', 'NotoSansDevanagari-Regular'],
  bold: ['NotoSans-Bold', 'NotoSansDevanagari-Bold'],
};

let loaded: Record<Weight, FontFace[]> | null = null;

function loadFace(name: string): FontFace {
  const data = readFileSync(fileURLToPath(FONT_FILES[name]));
  const font = fontkit.create(data);
  const coverage = new Map<number, boolean>();
  return {
    name,
    data,
    has(codePoint: number) {
      let covered = coverage.get(codePoint);
      if (covered === undefined) {
        covered = font.hasGlyphForCodePoint(codePoint);
        coverage.set(codePoint, covered);
      }
      return covered;
    },
  };
}

/** Font files are read once and kept for the life of the process. */
export function getFaces(): Record<Weight, FontFace[]> {
  loaded ??= {
    regular: FAMILIES.regular.map(loadFace),
    bold: FAMILIES.bold.map(loadFace),
  };
  return loaded;
}

/** Joiners carry no glyph of their own but control how neighbouring letters combine. */
const isJoiner = (codePoint: number) => codePoint === 0x200c || codePoint === 0x200d;

/**
 * Split text into runs that can each be drawn with a single font. A run stays
 * in its current font for as long as that font has the glyphs, so spaces and
 * punctuation do not cause needless switching. Characters no font can draw
 * (emoji, unsupported scripts) are dropped rather than printed as empty boxes.
 */
export function toRuns(text: string, weight: Weight): TextRun[] {
  const faces = getFaces()[weight];
  const runs: TextRun[] = [];
  let current = null as FontFace | null;
  let buffer = '';

  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (isJoiner(codePoint)) {
      if (current) buffer += char;
      continue;
    }
    const face: FontFace | undefined =
      current && current.has(codePoint) ? current : faces.find((candidate) => candidate.has(codePoint));
    if (!face) continue;
    if (face !== current) {
      if (current && buffer) runs.push({ font: current.name, text: buffer });
      current = face;
      buffer = '';
    }
    buffer += char;
  }
  if (current && buffer) runs.push({ font: current.name, text: buffer });
  return runs;
}

/** Fraction of the letters in `text` that none of the bundled fonts can draw (0–1). */
export function unsupportedLetterShare(text: string): number {
  const faces = getFaces().regular;
  let letters = 0;
  let missing = 0;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    letters++;
    const codePoint = char.codePointAt(0)!;
    if (!faces.some((face) => face.has(codePoint))) missing++;
  }
  return letters === 0 ? 0 : missing / letters;
}
