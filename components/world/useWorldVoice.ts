// ============================================================
// components/world/useWorldVoice.ts
//
// Voice for the living World engine — the "tts + sts" the user asked
// for, mirroring the Messenger (Abeto) speak-with-characters feel.
//
// Two hooks, both PURE-BROWSER / no-key-by-design:
//
//   useWorldTTS()  — Text-to-Speech for an NPC reply.
//     1. POSTs the reply to /api/livebook/tts (Sarvam → Gemini chain,
//        per-character voice) and plays the returned audio blob.
//     2. On ANY failure — no TTS key configured (the route 500s), the
//        network is down, or the response isn't audio — falls back to
//        the browser's built-in `window.speechSynthesis`. So the no-key
//        path is REAL: replies are voiced either way. With a key, they
//        get the warm per-character Sarvam/Gemini voice.
//
//   useWorldSTT() — Speech-to-Text for asking a character.
//     Wraps the browser SpeechRecognition API (webkitSpeechRecognition
//     in Chrome/Edge). No server key is needed — recognition runs in
//     the browser. Returns { supported, listening, start, stop }; the
//     caller feeds the transcript as the `question` to the
//     ask-character LLM flow (when a key is set) or simply acknowledges
//     it (deterministic reply stays when no key).
//
// Both are gated by NEXT_PUBLIC_* flags (client-visible, default OFF)
// so the base experience stays silent unless an operator opts in:
//   NEXT_PUBLIC_KATHA_WORLD_TTS=1
//   NEXT_PUBLIC_KATHA_WORLD_VOICE_INPUT=1
//
// Honesty: nothing here is fake. TTS degrades to speechSynthesis; STT
// is the browser's own API. No credit burns unless a TTS key is set AND
// the operator enables the flag — and even then the speechSynthesis
// fallback covers the no-key dev path.
// ============================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const WORLD_TTS_ENABLED = process.env.NEXT_PUBLIC_KATHA_WORLD_TTS === '1';
export const WORLD_VOICE_INPUT_ENABLED = process.env.NEXT_PUBLIC_KATHA_WORLD_VOICE_INPUT === '1';

// Minimal structural typing for the vendor-prefixed SpeechRecognition API.
// The W3C SpeechRecognition type isn't in TS's lib.dom.d.ts, so we keep a
// narrow local shape — enough to use it safely without `any` leaking.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Pick a BCP-47 recognition lang from the book's narration language.
 *  Defaults to en-US; Hindi books get hi-IN. */
function recognitionLangFor(language?: string): string {
  if (language === 'hi') return 'hi-IN';
  return 'en-US';
}

// ── TTS ───────────────────────────────────────────────────────

export interface WorldTTS {
  speak: () => Promise<void>;
  stop: () => void;
  speaking: boolean;
  loading: boolean;
}

/** Speak `text` via the TTS route (with key) or speechSynthesis (no key). */
export function useWorldTTS(text: string, language?: string): WorldTTS {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setLoading(false);
  }, []);

  // No-key / failure fallback: the browser's built-in synthesizer. Declared
  // as a useCallback before `speak` so the linter doesn't flag it as
  // access-before-declaration, and so `speak` can list it as a dependency.
  const fallbackToSynthesis = useCallback((t: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setSpeaking(false);
      setLoading(false);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    if (language === 'hi') u.lang = 'hi-IN';
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setLoading(false);
    window.speechSynthesis.speak(u);
  }, [language]);

  const speak = useCallback(async () => {
    if (!text) return;
    // Stop anything already playing before starting a new utterance.
    stop();
    setSpeaking(true);
    setLoading(true);

    try {
      const res = await fetch('/api/livebook/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.slice(0, 1450),
          voice: 'narration',
          language: language ?? 'auto',
        }),
      });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && ct.startsWith('audio/')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { setSpeaking(false); setLoading(false); };
        audio.onerror = () => { setSpeaking(false); setLoading(false); };
        setLoading(false);
        await audio.play().catch(() => {
          // Autoplay block or decode error → fall back to synthesis.
          fallbackToSynthesis(text);
        });
        return;
      }
    } catch {
      // network / route error → fall through to synthesis
    }
    fallbackToSynthesis(text);
  }, [text, language, stop, fallbackToSynthesis]);

  // Revoke any blob URL + stop audio on unmount or text change.
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, [text]);

  return { speak, stop, speaking, loading };
}

// ── STT ───────────────────────────────────────────────────────

export interface WorldSTT {
  supported: boolean;
  listening: boolean;
  start: (onResult: (transcript: string) => void) => void;
  stop: () => void;
}

/** Browser speech-to-text. No key; gated by NEXT_PUBLIC_KATHA_WORLD_VOICE_INPUT. */
export function useWorldSTT(language?: string): WorldSTT {
  // useSyncExternalStore gives a hydration-safe, lint-blessed read of a
  // browser-only capability: server snapshot is always false (matches the
  // SSR render), client snapshot probes the real SpeechRecognition ctor.
  // No setState-in-effect, no hydration mismatch.
  const supported = useSyncExternalStore(
    () => () => {},                       // never subscribe — capability is static
    () => WORLD_VOICE_INPUT_ENABLED && getSpeechRecognitionCtor() !== null,
    () => false,                          // server snapshot
  );
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const start = useCallback((onResult: (transcript: string) => void) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = recognitionLangFor(language);
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) onResult(transcript.trim());
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [language]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }, []);

  // Clean up a live recognizer on unmount.
  useEffect(() => {
    return () => {
      try { recRef.current?.stop(); } catch { /* ignore */ }
    };
  }, []);

  return { supported, listening, start, stop };
}