import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { parseYouTubeUrl } from '../src/youtube/url.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeUrl', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `http://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?start=30`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/v/${ID}`,
    `youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
    ID,
  ])('accepts %s', (input) => {
    expect(parseYouTubeUrl(input)).toEqual({ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` });
  });

  it.each([
    ['', 'empty input'],
    ['   ', 'whitespace'],
    ['not a url', 'free text'],
    ['https://vimeo.com/123456789', 'another site'],
    ['https://www.youtube.com/', 'home page'],
    ['https://www.youtube.com/watch?v=short', 'malformed id'],
    ['https://www.youtube.com/playlist?list=PLabc', 'playlist'],
    ['https://www.youtube.com/@somechannel', 'channel handle'],
    ['https://www.youtube.com/channel/UCabc', 'channel'],
    ['https://youtu.be/', 'short link without id'],
    ['ftp://youtube.com/watch?v=dQw4w9WgXcQ', 'unsupported protocol'],
    ['https://evil.example/watch?v=dQw4w9WgXcQ', 'look-alike host'],
    ['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'look-alike subdomain'],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseYouTubeUrl(input)).toThrowError(AppError);
    try {
      parseYouTubeUrl(input);
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_URL');
      expect((err as AppError).status).toBe(400);
    }
  });

  it('rejects values that are not strings', () => {
    expect(() => parseYouTubeUrl(undefined)).toThrowError(AppError);
    expect(() => parseYouTubeUrl(42)).toThrowError(AppError);
  });

  it('explains playlist and channel links in the error detail', () => {
    for (const link of ['https://www.youtube.com/playlist?list=PLabc', 'https://www.youtube.com/@somechannel']) {
      expect(() => parseYouTubeUrl(link)).toThrowError(expect.objectContaining({ detail: expect.stringMatching(/single video/) }));
    }
  });
});
