/** Browsers cut off or stall on very long utterances, so text is spoken in short pieces. */
const MAX_CHUNK = 220;

/**
 * Split text into pieces short enough to speak reliably, breaking at sentence
 * ends where possible, then at commas, then at spaces.
 */
export function splitForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?…。！？।]+[.!?…。！？।]*["'”’)\]]*\s*/g) ?? [clean];
  const pieces: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > MAX_CHUNK) {
      const window = rest.slice(0, MAX_CHUNK);
      const comma = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
      const cut = comma > 60 ? comma + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : MAX_CHUNK;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }

  // Join short neighbours so speech does not pause after every few words.
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + piece.length + 1 <= MAX_CHUNK) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

/** Choose an installed voice for a language: exact match, then same base language. */
export function pickVoice<V extends { lang: string; default?: boolean }>(voices: V[], lang: string): V | null {
  const wanted = lang.toLowerCase().replace('_', '-');
  const base = wanted.split('-')[0];
  const normalise = (voice: V) => voice.lang.toLowerCase().replace('_', '-');
  return (
    voices.find((voice) => normalise(voice) === wanted) ??
    voices.find((voice) => normalise(voice).split('-')[0] === base && voice.default) ??
    voices.find((voice) => normalise(voice).split('-')[0] === base) ??
    null
  );
}

/**
 * Join separate pieces of text (a heading, a message, a hint) into one passage
 * to read aloud: each piece ends with exactly one full stop, and a piece that
 * only repeats the start of the next one is dropped.
 */
export function joinForSpeech(parts: (string | null | undefined)[]): string {
  const clean = parts.map((part) => (part ?? '').trim().replace(/[.\s]+$/, '')).filter(Boolean);
  return clean
    .filter((part, index) => !clean[index + 1]?.toLowerCase().startsWith(part.toLowerCase()))
    .map((part) => (/[!?।。]$/.test(part) ? part : `${part}.`))
    .join(' ');
}
