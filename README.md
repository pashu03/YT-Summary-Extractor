# Scriptline — YouTube Transcript & Summary Extractor

Paste a YouTube link and get the video's spoken content as text: a clean,
timestamped transcript, a short and a detailed summary, key topics and
keywords, with copy and download (TXT, PDF, SRT, VTT).

- **No AI services.** Summaries are extractive and statistical — TF-IDF,
  TextRank, maximal marginal relevance and TextTiling, all implemented in this
  repository. Every summary sentence is quoted from the video.
- **No database.** Each request is processed in memory and discarded when the
  response has been sent. There are no accounts, no history and no cookies.
- **Two services.** A Next.js frontend and an Express API, each deployable on its own.

## Features

| | |
| --- | --- |
| Links | Standard `watch` URLs, `youtu.be`, Shorts, embeds, live replays, or a bare video id |
| Captions | Creator captions preferred, YouTube auto-generated as fallback; any available language can be selected |
| Transcript | Readable paragraphs with timestamps, the original captions line by line, and in-transcript search |
| Summary | 2–5 sentence overview, key takeaways, and a section-by-section detailed summary |
| Sections | Creator chapters when the description lists them, otherwise detected from topic shifts |
| Keywords | Ranked words and multi-word phrases, plus the distinctive terms of each section |
| Export | Copy to clipboard; download TXT, PDF, SRT and VTT |
| View in English | One click switches a non-English result to the video's English captions and back, when the video has them |
| Language toggle | A Hindi / English switch on the Full Transcript and Detailed Summary tabs translates them on the device (Chrome), keeping the original |
| Read aloud | A speaker button on every block of content reads it aloud, with pause, stop and speed controls |
| Progress | Real progress streamed from the server while it works; requests can be cancelled |
| Errors | Clear messages for invalid links, missing captions, private, removed, age-restricted, region-blocked and live videos, rate limits and timeouts |

## Quick start

Requires **Node.js 22 or newer**.

```bash
npm run install:all   # installs the root, backend and frontend packages
npm run dev           # API on http://localhost:4000, web app on http://localhost:3000
```

Open <http://localhost:3000> and paste a link, or click one of the examples.

Other commands, all run from the project root:

```bash
npm test              # backend and frontend unit tests
npm run typecheck     # TypeScript, both packages
npm run lint          # ESLint (frontend)
npm run build         # production builds
npm start             # run the production builds
```

To try the text pipeline without the UI:

```bash
cd backend
npx tsx scripts/try.ts "https://www.youtube.com/watch?v=aircAruvnKk"
```

## Configuration

All settings are optional. Copy `backend/.env.example` to `backend/.env` and
`frontend/.env.example` to `frontend/.env.local` to change them.

**Backend**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Port the API listens on |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated browser origins allowed to call the API (`*` for any) |
| `YOUTUBE_TIMEOUT_MS` | `15000` | Timeout for each request to YouTube |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per client IP per minute |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the API, so client IPs are read correctly |
| `EXPORT_BODY_LIMIT` | `8mb` | Largest body accepted by the PDF endpoint |

**Frontend**

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL of the API. Compiled into the browser bundle, so set it before `npm run build` |

## How it works

```
Browser (Next.js)                         Express API                         YouTube
─────────────────                         ───────────                         ───────
paste link ──── POST /api/transcript ───▶ validate link
                (streams NDJSON)          fetch video details ───────────────▶ player endpoint
◀── progress, video details ────────────  choose caption track
                                          download captions ─────────────────▶ timed-text endpoint
                                          build sentences
                                          rank, segment, summarise (in memory)
◀── result ─────────────────────────────  discard everything
TXT / SRT / VTT built in the browser
PDF ─────────── POST /api/export/pdf ───▶ render PDF from the posted result
◀── file ───────────────────────────────  discard everything
```

The result lives only in the browser tab's memory. Because the server keeps
nothing, the browser sends the result back when it asks for a PDF.

### Text pipeline

Everything below is in `backend/src/nlp/` and has unit tests.

1. **Sentences** (`sentences.ts`). Caption cues become a stream of timed words.
   Punctuated captions are split at sentence boundaries, with handling for
   abbreviations, initials and decimals. Unpunctuated captions (older
   auto-generated tracks) are split into sentence-sized chunks by scoring every
   candidate break: pauses in speech, words that open a new thought, and caption
   boundaries score well; breaking after a word that needs a complement scores badly.
2. **Tokens** (`tokenize.ts`, `stopwords.ts`). Words are lower-cased, stopwords
   removed and, for English, stemmed (Porter). Scripts written without spaces
   are segmented with `Intl.Segmenter`.
3. **TF-IDF** (`tfidf.ts`). Each sentence becomes a normalised sparse vector.
4. **TextRank** (`textrank.ts`). Sentences are nodes, cosine similarity is the
   edge weight, and weighted PageRank gives each sentence a centrality score. An
   inverted index means only sentences that share a term are ever compared.
5. **Keywords** (`keywords.ts`). TextRank over a word co-occurrence graph,
   blended with frequency. Multi-word phrases are runs of adjacent content words,
   scored by the strength of their words and how consistently they occur together.
6. **Sections** (`segmenter.ts`). Chapters from the video description are used
   when present. Otherwise TextTiling compares the vocabulary before and after
   every gap between sentences and places boundaries at the deepest dips.
7. **Summaries** (`analyze.ts`). Sentence scores combine centrality, keyword
   density, overlap with the title and position, with penalties for channel
   housekeeping ("subscribe", sponsor reads) and sentences that do not stand
   alone. Maximal marginal relevance then picks sentences that are relevant but
   not redundant — for the short summary, the takeaways and each section.

A 19-minute video (3,400 words) is analysed in about 50 ms; almost all of the
response time is the two requests to YouTube.

## API

### `POST /api/transcript`

```json
{ "url": "https://youtu.be/aircAruvnKk", "language": "hi" }
```

`language` is optional: a caption track id from `captions.available`, or a
language code. Without it the spoken language is used.

- Default response: the result as JSON, with an HTTP status code on failure.
- With `Accept: application/x-ndjson` (or `?stream=1`): newline-delimited JSON
  events — `progress`, `video`, then `result` or `error`.

```bash
curl -X POST http://localhost:4000/api/transcript \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtu.be/Tn6-PIqc4UM"}'
```

The result contains `video`, `captions`, `transcript` (`cues`, `paragraphs`),
`summary` (`short`, `takeaways`, `sections`), `keywords` and `stats`. The types
are in `backend/src/types.ts`.

### `POST /api/export/pdf`

Takes the parts of a result to print and returns `application/pdf`. See
`exportSchema` in `backend/src/routes/export.ts` for the body.

### `GET /api/health`

Returns `{ "status": "ok" }`.

### Errors

Errors have the shape `{ "error": { "code", "message", "detail"? } }`.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `INVALID_URL` | 400 | Not a link to a single YouTube video |
| `VIDEO_UNAVAILABLE`, `VIDEO_REMOVED` | 404 | The video does not exist or was taken down |
| `VIDEO_PRIVATE`, `AGE_RESTRICTED`, `LOGIN_REQUIRED`, `REGION_RESTRICTED`, `RESTRICTED` | 403 | YouTube restricts access; this is reported, never worked around |
| `LIVE_CONTENT` | 422 | Live stream or premiere without finished captions |
| `NO_CAPTIONS`, `EMPTY_TRANSCRIPT` | 422 | The video has no captions, or they contain no speech |
| `LANGUAGE_UNAVAILABLE` | 422 | No captions in the requested language; the response lists those available |
| `UNSUPPORTED_SCRIPT` | 422 | PDF export cannot draw the transcript's writing system |
| `RATE_LIMITED` | 429 | Too many requests from one address |
| `EXTRACTION_FAILED`, `NETWORK_ERROR` | 502 | Captions could not be retrieved or YouTube was unreachable |
| `UPSTREAM_BLOCKED` | 503 | YouTube is refusing or throttling requests from the server |
| `TIMEOUT` | 504 | YouTube did not answer in time |

## Privacy and data handling

- No database, files or cache. Request data exists in local variables for the
  duration of one request.
- No accounts, cookies or local storage. Reloading the page clears the result.
- Access logs record method, path, status and duration only — never the video
  link, query string or body.
- Rate limiting keeps an in-memory hit count per client address for one minute.
- API responses are sent with `Cache-Control: no-store`.
- Requests to YouTube are anonymous. Videos that need sign-in (private,
  age-restricted, members-only) are reported as such.
- The only third parties contacted are YouTube (captions, thumbnails and the
  optional embedded player) and Google Fonts at build time.

## Read aloud

For people who find reading difficult, speaker buttons read content aloud: the
introduction and each landing section, the video title, the summary,
takeaways, outline and keywords, each section of the detailed summary, the
whole transcript or any single paragraph, the key topics, and error messages.

- It uses the browser's built-in speech engine (`speechSynthesis`), so text is
  spoken on the visitor's device and nothing is sent anywhere.
- One thing plays at a time. A bar at the bottom of the screen shows what is
  being read, with pause/resume, stop and a speed setting (0.75× to 1.5×).
- Content is read in the caption language. Which voices exist depends on the
  device; if none matches the language the app says so. Browsers without speech
  support do not show the buttons.
- The code is in `frontend/src/components/speech.tsx` and `frontend/src/lib/speech.ts`.

## Deployment

The frontend and API are independent Node.js services.

**API** — any Node.js host. Build with `npm run build`, start with
`npm start` in `backend/`. Set `CORS_ORIGIN` to the frontend's origin and
`TRUST_PROXY` to the number of proxies in front of it. `backend/assets/` (the
PDF fonts) must be deployed alongside `dist/`.

**Frontend** — Vercel or any Node.js host. Set `NEXT_PUBLIC_API_URL` to the
API's public URL *at build time*.

**Vercel** — deploy the repository twice, as two projects:

1. **API:** Root Directory `backend`, preset **Express**. Vercel serves the
   default export of `src/index.ts`. After the web app is deployed, add the
   environment variable `CORS_ORIGIN` with the web app's URL (for example
   `https://your-app.vercel.app`, no trailing slash) and redeploy.
2. **Web app:** Root Directory `frontend`, preset **Next.js**. Add
   `NEXT_PUBLIC_API_URL` with the API project's URL before deploying.

`TRUST_PROXY` defaults to 1 on Vercel, so rate limiting sees real client addresses.

**Docker** — `docker compose up --build` builds and runs both. The Docker
files were written for this project but have not been run on the machine it
was developed on, so treat them as a starting point and test them first.

**One thing to check before going live:** YouTube frequently challenges or
blocks anonymous requests from data-centre IP ranges. If the API returns
`UPSTREAM_BLOCKED` in production while working locally, the host's IP range is
the likely cause; a different host or region is the usual remedy.

## Limitations

- **Captions are required.** If a video has no captions the app says so. Local
  speech recognition (for example Vosk) is not included: it would mean
  downloading the video's audio, which conflicts with respecting YouTube's
  terms. `fetchCaptionCues` in `backend/src/youtube/captions.ts` is the seam
  where a recogniser returning the same cue shape could be added for content
  you have the rights to.
- **Summaries are extractive.** They quote the video rather than paraphrase it,
  so they read less smoothly than generated text, and on unpunctuated captions
  the quoted lines are sentence-sized chunks rather than true sentences.
- **Language support varies.** Sentence ranking works for any language.
  Stopword lists cover about 60 languages; stemming is English-only.
- **Translation is browser-dependent.** The Hindi | English toggle on the
  Full Transcript and Detailed Summary tabs uses the browser's built-in Translator API (desktop Chrome
  138+). It runs on the visitor's device — nothing is sent to a server — but it
  is a machine-learning model, the one exception to "no AI" in this project,
  and it is used only for that toggle. The first use of a language pair
  downloads a language pack. In other browsers the translated options are
  disabled. Translations are approximate; the original wording is one click
  away and is never modified. The code is in `frontend/src/lib/translate.ts` and
  `frontend/src/components/results/translation.tsx`.
- **"View in English" needs English captions.** That button (on the video card)
  switches to English captions the video already has. YouTube's own caption
  translation answers anonymous requests with HTTP 429, and getting around
  that would be bypassing an access control.
- **PDF scripts.** PDFs can draw Latin, Greek, Cyrillic and Devanagari. Other
  scripts (Chinese, Japanese, Korean, Arabic and others) get a clear error and
  can use TXT, SRT or VTT. `backend/assets/fonts/README.md` explains how to add fonts.
- **YouTube can change.** The API uses the same public endpoints as YouTube's
  own apps, which are undocumented. If extraction stops working, the client
  versions in `backend/src/youtube/innertube.ts` are the first thing to update.
- **Terms of use.** Only publicly available captions are read. Transcripts
  remain their creators' work; anyone deploying or using this is responsible
  for complying with YouTube's terms and copyright law.

## Project structure

```
backend/
  src/
    index.ts, app.ts, config.ts     server start-up, middleware, settings
    pipeline.ts                     one request, end to end
    errors.ts, types.ts             error catalogue, API types
    routes/                         /api/transcript, /api/export
    youtube/                        link parsing, player client, captions, metadata
    nlp/                            sentences, TF-IDF, TextRank, keywords, sections, summaries
    pdf/                            PDF report and font fallback
  assets/fonts/                     Noto fonts for PDF export (OFL)
  scripts/                          command-line helpers for trying the pipeline
  tests/                            unit and HTTP tests (no network access needed)
frontend/
  src/app/                          layout, page, theme
  src/components/                   UI, including results/ for the four tabs
  src/hooks/, src/lib/              request state, API client, exporters
```

## Tech stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix) ·
Node.js, Express 5, Zod, PDFKit · Vitest.
