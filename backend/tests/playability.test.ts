import { describe, expect, it } from 'vitest';
import { classifyPlayability, type PlayerResponse } from '../src/youtube/innertube.js';
import { buildVideoMeta, parseChapters } from '../src/youtube/metadata.js';

/** Payloads below mirror what YouTube returned for real videos in each state. */
const cases: [string, PlayerResponse, string, boolean][] = [
  ['a missing video', { playabilityStatus: { status: 'ERROR', reason: 'This video is unavailable' } }, 'VIDEO_UNAVAILABLE', false],
  [
    'a removed video',
    { playabilityStatus: { status: 'ERROR', reason: "This video has been removed for violating YouTube's Terms of Service" } },
    'VIDEO_REMOVED',
    false,
  ],
  [
    'a private video',
    {
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'This video is private',
        errorScreen: {
          playerErrorMessageRenderer: {
            subreason: { runs: [{ text: 'If the owner of this video has granted you access, please sign in.' }] },
          },
        },
      },
    },
    'VIDEO_PRIVATE',
    false,
  ],
  [
    'an age-restricted video',
    {
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'This video may be inappropriate for some users.',
        desktopLegacyAgeGateReason: 1,
      },
    },
    'AGE_RESTRICTED',
    false,
  ],
  [
    'a members-only video',
    { playabilityStatus: { status: 'UNPLAYABLE', reason: 'Join this channel to get access to members-only content like this video.' } },
    'LOGIN_REQUIRED',
    false,
  ],
  [
    'a region-blocked video',
    { playabilityStatus: { status: 'UNPLAYABLE', reason: 'The uploader has not made this video available in your country' } },
    'REGION_RESTRICTED',
    false,
  ],
  [
    'a live stream',
    {
      playabilityStatus: { status: 'UNPLAYABLE', reason: 'This live stream recording is not available.' },
      videoDetails: { isLiveContent: true },
    },
    'LIVE_CONTENT',
    false,
  ],
  ['a stream that is live right now', { playabilityStatus: { status: 'OK' }, videoDetails: { isLive: true } }, 'LIVE_CONTENT', false],
  [
    'a bot check',
    { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } },
    'UPSTREAM_BLOCKED',
    true,
  ],
  ['a client that YouTube rejects', { playabilityStatus: { status: 'UNPLAYABLE', reason: 'The page needs to be reloaded.' } }, 'EXTRACTION_FAILED', true],
  ['an empty response', {}, 'EXTRACTION_FAILED', true],
];

describe('classifyPlayability', () => {
  it('returns null for a playable video', () => {
    expect(classifyPlayability({ playabilityStatus: { status: 'OK' }, videoDetails: { isLiveContent: false } })).toBeNull();
  });

  it('treats a finished live stream as a normal video', () => {
    expect(classifyPlayability({ playabilityStatus: { status: 'OK' }, videoDetails: { isLiveContent: true } })).toBeNull();
  });

  it.each(cases)('recognises %s', (_label, player, code, inconclusive) => {
    const result = classifyPlayability(player);
    expect(result?.error.code).toBe(code);
    expect(result?.inconclusive).toBe(inconclusive);
  });

  it("keeps YouTube's own explanation as the error detail", () => {
    const result = classifyPlayability({ playabilityStatus: { status: 'ERROR', reason: 'This video is unavailable' } });
    expect(result?.error.detail).toBe('This video is unavailable');
  });
});

describe('buildVideoMeta', () => {
  it('picks the largest thumbnail and parses numeric fields', () => {
    const meta = buildVideoMeta('aircAruvnKk', {
      videoDetails: {
        title: ' But what is a neural network? ',
        author: '3Blue1Brown',
        channelId: 'UCYO_jab_esuFRV4b17AJtAw',
        lengthSeconds: '1120',
        viewCount: '25300837',
        thumbnail: {
          thumbnails: [
            { url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120, height: 90 },
            { url: 'https://i.ytimg.com/vi/x/sddefault.jpg', width: 640, height: 480 },
            { url: 'https://i.ytimg.com/vi/x/mqdefault.jpg', width: 320, height: 180 },
          ],
        },
      },
    });
    expect(meta).toEqual({
      id: 'aircAruvnKk',
      url: 'https://www.youtube.com/watch?v=aircAruvnKk',
      title: 'But what is a neural network?',
      author: '3Blue1Brown',
      channelUrl: 'https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw',
      durationSeconds: 1120,
      thumbnailUrl: 'https://i.ytimg.com/vi/x/sddefault.jpg',
      viewCount: 25300837,
    });
  });

  it('falls back gracefully when details are missing', () => {
    const meta = buildVideoMeta('abcdefghijk', {});
    expect(meta.title).toBe('Untitled video');
    expect(meta.durationSeconds).toBe(0);
    expect(meta.viewCount).toBeNull();
    expect(meta.thumbnailUrl).toContain('abcdefghijk');
  });
});

describe('parseChapters', () => {
  it('reads a standard chapter list', () => {
    const description = 'Great video!\n\n0:00 Intro\n1:07 Series preview\n2:42 - What are neurons?\n1:02:03 Wrap up\n\nFollow me';
    expect(parseChapters(description, 4000)).toEqual([
      { start: 0, title: 'Intro' },
      { start: 67, title: 'Series preview' },
      { start: 162, title: 'What are neurons?' },
      { start: 3723, title: 'Wrap up' },
    ]);
  });

  it('accepts timestamps after the title and bracketed timestamps', () => {
    const description = 'Intro - 0:00\nSetup (1:30)\n[3:00] Results';
    expect(parseChapters(description, 600).map((c) => c.start)).toEqual([0, 90, 180]);
  });

  it('adds an introduction when the first chapter starts late', () => {
    const chapters = parseChapters('1:00 First\n2:00 Second\n3:00 Third', 600);
    expect(chapters[0]).toEqual({ start: 0, title: 'Introduction' });
    expect(chapters).toHaveLength(4);
  });

  it('ignores a stray timestamp before the real list', () => {
    const description = 'Skip to 12:30 for the demo\n0:00 Intro\n2:00 Build\n5:00 Demo\n9:00 Outro';
    expect(parseChapters(description, 900).map((c) => c.title)).toEqual(['Intro', 'Build', 'Demo', 'Outro']);
  });

  it('returns nothing without at least three usable timestamps', () => {
    expect(parseChapters('0:00 Intro\n1:00 Outro', 600)).toEqual([]);
    expect(parseChapters('No timestamps here', 600)).toEqual([]);
    expect(parseChapters(undefined, 600)).toEqual([]);
  });

  it('drops timestamps beyond the end of the video', () => {
    expect(parseChapters('0:00 A\n1:00 B\n2:00 C\n59:00 D', 300).map((c) => c.title)).toEqual(['A', 'B', 'C']);
  });
});
