import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * English function words plus the fillers and light verbs that dominate
 * spoken transcripts. Curated by hand: general-purpose lists either miss the
 * fillers ("gonna", "yeah") or throw away real content words.
 */
const ENGLISH = `
a about above across after afterwards again against ago ah ain't all almost alone along already alright also although
always am among amongst an and another any anybody anyhow anymore anyone anything anyway anywhere are aren't around as
aside at away aw back be became because become becomes been before beforehand behind being below beside besides
between beyond both bit but by bye came can can't cannot come comes coming could couldn't d did didn't do does doesn't
doing don't done down during each eh either else elsewhere enough even ever every everybody everyone everything
everywhere except far few for from further get gets getting give gives go goes going gone gonna got gotta gotten had
hadn't has hasn't have haven't having he he'd he'll he's hello hence her here here's hers herself hey hi him himself
his hm hmm how how's however huh i i'd i'll i'm i've if in indeed instead into is isn't it it'd it'll it's its itself
just kind kinda know known knows less let let's like likely literally ll look looking looks lot lots m made make makes
making many may maybe me mean means meanwhile might mine more moreover most mostly much must mustn't my myself namely
neither never nevertheless next no nobody none nor not nothing now nowhere of off often oh ok okay on once one ones
only onto or other others otherwise ought our ours ourselves out over own per perhaps please pretty put puts quite
rather re really right s said same saw say saying says see seem seemed seeming seems seen several shall shan't she
she'd she'll she's should shouldn't since so some somebody somehow someone something sometime sometimes somewhat
somewhere sort sorta still stuff such sure t take takes taking talk talking tell than thank thanks that that'll
that's the their theirs them themselves then there there's thereby therefore these they they'd they'll they're
they've thing things think this those though through throughout thus to today together too took toward towards try
trying two uh uhh um umm under unless until up upon us use used uses using ve very via want wanna wants was wasn't
way we we'd we'll we're we've well went were weren't what what's whatever when whenever where where's whereas
wherever whether which while who who's whoever whole whom whose why why's will with within without won't would
wouldn't wow y'all yeah yep yes yet you you'd you'll you're you've your yours yourself yourselves actually basically
essentially obviously probably definitely simply totally guys guy
music applause laughter laughs cheering inaudible
`;

const EXTRA: Record<string, string> = {
  en: ENGLISH,
  // Hinglish/Marathi fillers that the published lists omit.
  hi: 'है हैं था थी थे हो हूँ हूं तो ही भी और या कि की का के को में से पर ने यह वह ये वो एक कुछ नहीं हाँ जी अच्छा ठीक मतलब यानी बहुत',
  mr: 'आहे आहेत होता होती होते आणि किंवा की हा ही हे तो ती ते या ला ने चा ची चे मध्ये वर पण तर म्हणजे नाही हो',
};

/** YouTube and legacy codes that differ from the ISO 639-1 keys of the stopword data. */
const ALIASES: Record<string, string> = { iw: 'he', in: 'id', ji: 'yi', fil: 'tl', nb: 'no', nn: 'no', cmn: 'zh', yue: 'zh' };

let published: Record<string, string[]> | null = null;
const cache = new Map<string, Set<string>>();

/** "pt-BR" → "pt", "iw" → "he". */
export function primaryLanguage(code: string | undefined): string {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
  return ALIASES[base] ?? base;
}

const normalise = (word: string) => word.toLowerCase().replace(/[’`]/g, "'");

/**
 * Stopwords for a language. English uses the curated list above; other
 * languages come from the `stopwords-iso` data set. Unknown languages get an
 * empty set, and ranking then relies on inverse document frequency alone.
 */
export function getStopwords(languageCode: string | undefined): Set<string> {
  const lang = primaryLanguage(languageCode);
  const cached = cache.get(lang);
  if (cached) return cached;

  const words = new Set<string>();
  if (lang !== 'en') {
    published ??= require('stopwords-iso') as Record<string, string[]>;
    for (const word of published[lang] ?? []) words.add(normalise(word));
  }
  for (const word of (EXTRA[lang] ?? '').split(/\s+/)) {
    if (word) words.add(normalise(word));
  }
  cache.set(lang, words);
  return words;
}
