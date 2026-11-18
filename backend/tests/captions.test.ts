import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  cleanCaptionText,
  listCaptionTracks,
  parseJson3,
  parseTimedTextXml,
  selectCaptionTrack,
} from '../src/youtube/captions.js';
import type { PlayerResponse } from '../src/youtube/innertube.js';

describe('cleanCaptionText', () => {
  it('decodes double-escaped entities, strips markup and collapses whitespace', () => {
    expect(cleanCaptionText('It&amp;#39;s  <i>really</i>\n good &amp;amp; simple')).toBe("It's really good & simple");
  });

  it('decodes numeric and hexadecimal entities', () => {
    expect(cleanCaptionText('caf&#233; &#x1F600; &quot;hi&quot;')).toBe('café 😀 "hi"');
  });

  it('leaves unknown entities untouched', () => {
    expect(cleanCaptionText('R&D; &notanentity;')).toBe('R&D; &notanentity;');
  });
});

describe('parseJson3', () => {
  it('reads cues and per-word timings, skipping layout-only events', () => {
    const body = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 5000, id: 1 },
        {
          tStartMs: 240,
          dDurationMs: 4559,
          segs: [{ utf8: 'react' }, { utf8: ' a', tOffsetMs: 559 }, { utf8: ' javascript', tOffsetMs: 720 }],
        },
        { tStartMs: 2710, dDurationMs: 2089, aAppend: 1, segs: [{ utf8: '\n' }] },
        { tStartMs: 2720, dDurationMs: 4079, segs: [{ utf8: 'user' }, { utf8: ' interfaces', tOffsetMs: 320 }] },
      ],
    });
    const cues = parseJson3(body);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 0.24, duration: 4.559, text: 'react a javascript' });
    expect(cues[0].words).toEqual([
      { text: 'react', time: 0.24 },
      { text: 'a', time: 0.799 },
      { text: 'javascript', time: 0.96 },
    ]);
    expect(cues[1].text).toBe('user interfaces');
  });

  it('has no word timings for human-made captions', () => {
    const cues = parseJson3(JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello\nworld' }] }] }));
    expect(cues).toEqual([{ start: 1, duration: 2, text: 'Hello world', words: undefined }]);
  });

  it('throws on a payload that is not timed text', () => {
    expect(() => parseJson3('{"error":"nope"}')).toThrow();
    expect(() => parseJson3('<html>')).toThrow();
  });
});

describe('parseTimedTextXml', () => {
  it('reads the legacy <text> format (seconds)', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8" ?><transcript><text start="4.28" dur="4.08">This is a three. It&amp;#39;s sloppily written</text><text start="6.84" dur="4.4">and rendered</text></transcript>';
    expect(parseTimedTextXml(xml)).toEqual([
      { start: 4.28, duration: 4.08, text: "This is a three. It's sloppily written" },
      { start: 6.84, duration: 4.4, text: 'and rendered' },
    ]);
  });

  it('reads the srv3 <p> format (milliseconds)', () => {
    const xml =
      '<timedtext format="3"><body><p t="240" d="4559" w="1"><s ac="255">react</s><s t="559"> a</s></p><p t="2710" d="2089" a="1">\n</p></body></timedtext>';
    expect(parseTimedTextXml(xml)).toEqual([{ start: 0.24, duration: 4.559, text: 'react a' }]);
  });
});

const track = (languageCode: string, kind?: string, vssId?: string) => ({
  baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}&kind=${kind ?? ''}`,
  languageCode,
  kind,
  vssId: vssId ?? `${kind === 'asr' ? 'a' : ''}.${languageCode}`,
  name: { runs: [{ text: `${languageCode}${kind === 'asr' ? ' (auto-generated)' : ''}` }] },
});

function playerWith(tracks: ReturnType<typeof track>[], audioTracks?: object[], defaultAudioTrackIndex = 0): PlayerResponse {
  return {
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks, audioTracks, defaultAudioTrackIndex } },
  } as PlayerResponse;
}

describe('listCaptionTracks', () => {
  it('only keeps caption URLs that point at YouTube over HTTPS', () => {
    const player = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en', vssId: '.en' },
            { baseUrl: '/api/timedtext?v=x&lang=fr', languageCode: 'fr', vssId: '.fr' },
            { baseUrl: 'https://internal.example/api/timedtext', languageCode: 'de', vssId: '.de' },
            { baseUrl: 'http://www.youtube.com/api/timedtext?v=x', languageCode: 'es', vssId: '.es' },
            { baseUrl: 'https://youtube.com.evil.example/api/timedtext', languageCode: 'it', vssId: '.it' },
          ],
        },
      },
    } as PlayerResponse;
    const tracks = listCaptionTracks(player);
    expect(tracks.map((t) => t.id)).toEqual(['.en', '.fr']);
    expect(tracks[1].baseUrl).toBe('https://www.youtube.com/api/timedtext?v=x&lang=fr');
  });
});

describe('selectCaptionTrack', () => {
  it('prefers human-made captions in the spoken language over auto-generated ones', () => {
    const player = playerWith([track('fr'), track('en'), track('en', 'asr')]);
    expect(selectCaptionTrack(listCaptionTracks(player), player).id).toBe('.en');
  });

  it('falls back to the auto-generated track of the spoken language', () => {
    const player = playerWith([track('es'), track('ja', 'asr')]);
    expect(selectCaptionTrack(listCaptionTracks(player), player).id).toBe('a.ja');
  });

  it('uses the original audio language when a video is dubbed into many languages', () => {
    // Auto-dubbed videos list an auto-generated track for every dub; the first is not the original.
    const player = playerWith(
      [track('ar'), track('ar', 'asr'), track('bn', 'asr'), track('en', 'asr'), track('en', undefined, '.en.abc')],
      [{ audioTrackId: 'ar.10' }, { audioTrackId: 'en-US.4', defaultCaptionTrackIndex: 4 }],
      1,
    );
    expect(selectCaptionTrack(listCaptionTracks(player), player).id).toBe('.en.abc');
  });

  it('uses the creator default, then English, when the spoken language is unknown', () => {
    const withDefault = playerWith([track('de'), track('it')], [{ defaultCaptionTrackIndex: 1 }]);
    expect(selectCaptionTrack(listCaptionTracks(withDefault), withDefault).id).toBe('.it');

    const noDefault = playerWith([track('de'), track('en-GB')]);
    expect(selectCaptionTrack(listCaptionTracks(noDefault), noDefault).id).toBe('.en-GB');
  });

  it('honours an explicit request by track id, language code or base language', () => {
    const player = playerWith([track('en'), track('en', 'asr'), track('pt-BR')]);
    const tracks = listCaptionTracks(player);
    expect(selectCaptionTrack(tracks, player, 'a.en').id).toBe('a.en');
    expect(selectCaptionTrack(tracks, player, 'en').id).toBe('.en');
    expect(selectCaptionTrack(tracks, player, 'pt').id).toBe('.pt-BR');
  });

  it('reports the available languages when the requested one is missing', () => {
    const player = playerWith([track('en'), track('es')]);
    try {
      selectCaptionTrack(listCaptionTracks(player), player, 'ja');
      expect.unreachable();
    } catch (err) {
      const error = err as AppError;
      expect(error.code).toBe('LANGUAGE_UNAVAILABLE');
      expect(error.availableLanguages?.map((t) => t.languageCode)).toEqual(['en', 'es']);
    }
  });

  it('throws NO_CAPTIONS when the video has no tracks', () => {
    const player = playerWith([]);
    expect(() => selectCaptionTrack(listCaptionTracks(player), player)).toThrowError(
      expect.objectContaining({ code: 'NO_CAPTIONS' }),
    );
  });
});
