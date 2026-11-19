import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The transcript-service path, with YouTube and Supadata replaced by canned
 * responses so the tests are offline and spend no API credits.
 */

type Handler = (url: URL) => { status: number; body: unknown };

const BOT_CHECK = {
  playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" },
};
const OEMBED = { title: 'Real Title', author_name: 'Some Channel', author_url: 'https://www.youtube.com/@some' };
const TRANSCRIPT = {
  lang: 'en',
  availableLangs: ['en', 'hi'],
  content: [
    { text: 'Welcome to the lesson. Today we learn about compilers.', offset: 0, duration: 4000, lang: 'en' },
    { text: 'A compiler turns source code into machine code &amp; more.', offset: 4000, duration: 5000, lang: 'en' },
    { text: 'Parsing builds a syntax tree from the tokens.', offset: 9000, duration: 4000, lang: 'en' },
    { text: 'Code generation then emits instructions for the target.', offset: 13000, duration: 6000, lang: 'en' },
  ],
};

const calls: string[] = [];

function install(handlers: { player?: Handler; oembed?: Handler; supadata?: Handler }) {
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.hostname}${url.pathname}`);
    const pick = url.hostname === 'api.supadata.ai'
      ? handlers.supadata
      : url.pathname === '/oembed'
        ? handlers.oembed
        : url.pathname.startsWith('/youtubei/')
          ? handlers.player
          : undefined;
    if (!pick) throw new Error(`unexpected request to ${url}`);
    if (url.hostname === 'api.supadata.ai') {
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-key');
      expect(url.searchParams.get('mode') ?? 'native').toBe('native');
    }
    const { status, body } = pick(url);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
}

async function loadPipeline(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('../src/pipeline.js');
}

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('transcript service', () => {
  it('falls back to the service when YouTube refuses the server, and builds a full result', async () => {
    install({
      player: () => ({ status: 200, body: BOT_CHECK }),
      oembed: () => ({ status: 200, body: OEMBED }),
      supadata: () => ({ status: 200, body: TRANSCRIPT }),
    });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'auto', SUPADATA_API_KEY: 'test-key' });
    const events: string[] = [];
    const result = await runPipeline({ url: 'https://youtu.be/dQw4w9WgXcQ' }, { emit: (e) => events.push(e.type) });

    expect(result.video).toMatchObject({ id: 'dQw4w9WgXcQ', title: 'Real Title', author: 'Some Channel', durationSeconds: 19 });
    expect(result.captions).toMatchObject({ id: 'en', languageCode: 'en', name: 'English' });
    expect(result.captions.available.map((t) => t.id)).toEqual(['en', 'hi']);
    expect(result.transcript.cues[1]).toMatchObject({ start: 4 });
    expect(result.transcript.cues[1].text).toContain('machine code & more');
    expect(result.summary.short.length).toBeGreaterThan(0);
    expect(events).toContain('video');
    expect(events.at(-1)).toBe('progress');
  });

  it('goes straight to the service when TRANSCRIPT_PROVIDER=supadata', async () => {
    install({
      oembed: () => ({ status: 200, body: OEMBED }),
      supadata: () => ({ status: 200, body: TRANSCRIPT }),
    });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'supadata', SUPADATA_API_KEY: 'test-key' });
    await runPipeline({ url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' });
    expect(calls.some((c) => c.includes('youtubei'))).toBe(false);
  });

  it('keeps the bot-check error when no service key is configured', async () => {
    install({ player: () => ({ status: 200, body: BOT_CHECK }) });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'auto', SUPADATA_API_KEY: '' });
    await expect(runPipeline({ url: 'https://youtu.be/dQw4w9WgXcQ' })).rejects.toMatchObject({ code: 'UPSTREAM_BLOCKED' });
  });

  it('waits for a queued job to finish', async () => {
    let polls = 0;
    install({
      oembed: () => ({ status: 200, body: OEMBED }),
      supadata: (url) => {
        if (url.pathname === '/v1/transcript') return { status: 202, body: { jobId: 'job-1' } };
        polls++;
        return { status: 200, body: polls < 2 ? { status: 'active' } : { status: 'completed', ...TRANSCRIPT } };
      },
    });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'supadata', SUPADATA_API_KEY: 'test-key' });
    const result = await runPipeline({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(polls).toBe(2);
    expect(result.transcript.cues).toHaveLength(4);
  }, 10_000);

  it.each([
    [206, { error: 'transcript-unavailable' }, 'NO_CAPTIONS'],
    [404, { error: 'not-found' }, 'VIDEO_UNAVAILABLE'],
    [403, { error: 'forbidden' }, 'RESTRICTED'],
    [401, { error: 'unauthorized' }, 'EXTRACTION_FAILED'],
    [429, { error: 'limit-exceeded' }, 'EXTRACTION_FAILED'],
    [500, 'oops', 'EXTRACTION_FAILED'],
  ])('maps service HTTP %i to %s', async (status, body, code) => {
    install({ oembed: () => ({ status: 200, body: OEMBED }), supadata: () => ({ status, body }) });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'supadata', SUPADATA_API_KEY: 'test-key' });
    const error = await runPipeline({ url: 'https://youtu.be/dQw4w9WgXcQ' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: expect.stringMatching(code) });
    expect(JSON.stringify((error as { toBody(): unknown }).toBody())).not.toContain('test-key');
  });

  it('reports a missing language instead of silently returning another one', async () => {
    install({ oembed: () => ({ status: 200, body: OEMBED }), supadata: () => ({ status: 200, body: TRANSCRIPT }) });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'supadata', SUPADATA_API_KEY: 'test-key' });
    const error = await runPipeline({ url: 'https://youtu.be/dQw4w9WgXcQ', language: 'a.fr' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'LANGUAGE_UNAVAILABLE' });
  });

  it('treats a video oEmbed does not know as unavailable without spending a service call', async () => {
    install({ oembed: () => ({ status: 400, body: 'Bad Request' }), supadata: () => ({ status: 200, body: TRANSCRIPT }) });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'supadata', SUPADATA_API_KEY: 'test-key' });
    await expect(runPipeline({ url: 'https://youtu.be/aaaaaaaaaaa' })).rejects.toMatchObject({ code: 'VIDEO_UNAVAILABLE' });
    expect(calls.some((c) => c.startsWith('api.supadata.ai'))).toBe(false);
  });

  it('rejects an empty transcript rather than reporting success', async () => {
    install({
      oembed: () => ({ status: 200, body: OEMBED }),
      supadata: () => ({ status: 200, body: { lang: 'en', availableLangs: ['en'], content: [] } }),
    });
    const { runPipeline } = await loadPipeline({ TRANSCRIPT_PROVIDER: 'supadata', SUPADATA_API_KEY: 'test-key' });
    await expect(runPipeline({ url: 'https://youtu.be/dQw4w9WgXcQ' })).rejects.toMatchObject({ code: 'EMPTY_TRANSCRIPT' });
  });
});
