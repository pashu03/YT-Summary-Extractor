'use client';

import { Pause, Play, Square, Volume2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { pickVoice, splitForSpeech } from '@/lib/speech';
import { cn } from '@/lib/utils';

interface SpeakRequest {
  /** Identifies the button that started playback, so it can show a Stop state. */
  id: string;
  /** Short name of what is being read, shown in the player bar. */
  label: string;
  text: string;
  /** BCP 47 language of the text, e.g. "en" or "hi". */
  lang: string;
}

interface SpeechApi {
  supported: boolean;
  current: { id: string; label: string } | null;
  paused: boolean;
  rate: number;
  speak: (request: SpeakRequest) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setRate: (rate: number) => void;
}

const SpeechContext = createContext<SpeechApi | null>(null);
const RATES = [0.75, 1, 1.25, 1.5];
const noSubscription = () => () => {};

/**
 * Read-aloud for the whole app, using the browser's built-in speech engine.
 * Text is spoken on the visitor's device: nothing is sent to a server. Only
 * one thing is read at a time; starting another stops the first.
 */
export function SpeechProvider({ children }: { children: ReactNode }) {
  const supported = useSyncExternalStore(
    noSubscription,
    () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
    () => false,
  );
  const [current, setCurrent] = useState<{ id: string; label: string } | null>(null);
  const [paused, setPaused] = useState(false);
  const [rate, setRateState] = useState(1);
  const rateRef = useRef(1);
  // Each playback gets a number; callbacks from an earlier, cancelled playback are ignored.
  const session = useRef(0);
  // Holding the utterance stops some browsers garbage-collecting it mid-speech.
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    session.current += 1;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setCurrent(null);
    setPaused(false);
  }, []);

  const speak = useCallback(({ id, label, text, lang }: SpeakRequest) => {
    const synth = window.speechSynthesis;
    const chunks = splitForSpeech(text);
    if (!synth || chunks.length === 0) return;

    session.current += 1;
    const mine = session.current;
    synth.cancel();

    const voices = synth.getVoices();
    const voice = pickVoice(voices, lang);
    if (!voice && voices.length > 0) {
      toast.info('No matching voice installed', {
        description: `Your device has no voice for this language (${lang}), so it may sound wrong. You can add voices in your system's speech settings.`,
      });
    }

    setCurrent({ id, label });
    setPaused(false);
    let index = 0;
    const next = () => {
      if (session.current !== mine) return;
      if (index >= chunks.length) {
        setCurrent(null);
        return;
      }
      const item = new SpeechSynthesisUtterance(chunks[index++]);
      item.lang = voice?.lang ?? lang;
      if (voice) item.voice = voice;
      item.rate = rateRef.current;
      item.onend = next;
      item.onerror = (event) => {
        if (session.current !== mine || event.error === 'canceled' || event.error === 'interrupted') return;
        session.current += 1;
        setCurrent(null);
        toast.error("Couldn't read this aloud", { description: 'Your browser reported a speech error. Please try again.' });
      };
      utterance.current = item;
      synth.speak(item);
    };
    next();
  }, []);

  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    window.speechSynthesis?.resume();
    setPaused(false);
  }, []);

  const setRate = useCallback((value: number) => {
    rateRef.current = value; // applies from the next sentence
    setRateState(value);
  }, []);

  // Never keep talking after the page is left or reloaded.
  useEffect(() => {
    const silence = () => window.speechSynthesis?.cancel();
    window.addEventListener('pagehide', silence);
    return () => {
      window.removeEventListener('pagehide', silence);
      silence();
    };
  }, []);

  const api = useMemo(
    () => ({ supported, current, paused, rate, speak, stop, pause, resume, setRate }),
    [supported, current, paused, rate, speak, stop, pause, resume, setRate],
  );

  return (
    <SpeechContext.Provider value={api}>
      {children}
      <SpeechBar />
    </SpeechContext.Provider>
  );
}

export function useSpeech(): SpeechApi {
  const api = useContext(SpeechContext);
  if (!api) throw new Error('useSpeech must be used inside <SpeechProvider>');
  return api;
}

interface ListenButtonProps {
  id: string;
  /** What will be read, for the tooltip and screen readers: "summary", "this paragraph". */
  label: string;
  /** The text to read. A function is called at click time, for text that is expensive to build. */
  text: string | (() => string);
  lang?: string;
  /** Show the word "Listen" beside the icon. */
  labelled?: boolean;
  variant?: 'outline' | 'ghost';
  className?: string;
}

/** A speaker button that reads a piece of content aloud; press again to stop. */
export function ListenButton({ id, label, text, lang = 'en', labelled = false, variant = 'ghost', className }: ListenButtonProps) {
  const { supported, current, speak, stop } = useSpeech();
  // Browsers without speech synthesis simply do not get the button.
  if (!supported) return null;

  const active = current?.id === id;
  const hint = active ? `Stop reading ${label}` : `Listen to ${label}`;
  return (
    <Button
      type="button"
      variant={variant}
      size={labelled ? 'sm' : 'icon-sm'}
      aria-pressed={active}
      aria-label={hint}
      title={hint}
      onClick={() => (active ? stop() : speak({ id, label, lang, text: typeof text === 'function' ? text() : text }))}
      className={cn('shrink-0', active ? 'bg-accent text-primary' : !labelled && 'text-chart-1', className)}
    >
      {active ? <Square className="size-3.5! fill-current" /> : <Volume2 />}
      {labelled && (active ? 'Stop' : 'Listen')}
    </Button>
  );
}

/** Player controls shown at the bottom of the screen while something is being read. */
function SpeechBar() {
  const { current, paused, rate, pause, resume, stop, setRate } = useSpeech();
  if (!current) return null;

  return (
    <div
      role="region"
      aria-label="Read aloud controls"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-2 rounded-2xl bg-primary py-2 pr-2 pl-4 text-primary-foreground shadow-xl"
    >
      <Volume2 className={cn('size-4 shrink-0 text-sky-300', !paused && 'animate-pulse')} aria-hidden />
      <p className="min-w-0 flex-1 truncate text-sm" role="status">
        {paused ? 'Paused' : 'Reading'}: <span className="font-medium">{current.label}</span>
      </p>
      <label className="sr-only" htmlFor="speech-rate">
        Reading speed
      </label>
      <select
        id="speech-rate"
        value={rate}
        onChange={(event) => setRate(Number(event.target.value))}
        className="h-8 rounded-lg bg-white/10 px-1.5 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-300 [&>option]:text-foreground"
      >
        {RATES.map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={paused ? resume : pause}
        aria-label={paused ? 'Resume reading' : 'Pause reading'}
        className="text-white hover:bg-white/15 hover:text-white"
      >
        {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
      </Button>
      <Button type="button" variant="ghost" size="icon" onClick={stop} aria-label="Stop reading" className="text-white hover:bg-white/15 hover:text-white">
        <X />
      </Button>
    </div>
  );
}
