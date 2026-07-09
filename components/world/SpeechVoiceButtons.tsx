// ============================================================
// components/world/SpeechVoiceButtons.tsx
//
// The TTS "Hear" + STT "Speak" buttons for the World speech
// overlay — the "tts + sts" the user asked for. This is split out
// of SpeechBody (in LivingWorldScreen.tsx) and lazy-loaded via
// next/dynamic so the useWorldVoice module (and its browser
// SpeechRecognition/SpeechSynthesis wrappers) is NOT pulled into
// the World screen's initial mount bundle. The voice chunk only
// loads when a speech overlay actually opens — keeping the cold
// mount fast (the Playwright e2e asserts `.world-viewport` is
// visible within 15s; eager-loading voice here pushed it past
// that in headless Chromium). Both flags default OFF, so when no
// operator has opted in this component renders nothing and the
// chunk is still only fetched on first overlay open.
// ============================================================

import { useState } from 'react';
import { useWorldTTS, useWorldSTT, WORLD_TTS_ENABLED, WORLD_VOICE_INPUT_ENABLED } from '@/components/world/useWorldVoice';

export interface SpeechVoiceButtonsProps {
  text: string;
  bookLanguage?: string;
  llmAvailable: boolean;
  onSpokenAsk: (question: string) => void;
}

export default function SpeechVoiceButtons({ text, bookLanguage, llmAvailable, onSpokenAsk }: SpeechVoiceButtonsProps) {
  const tts = useWorldTTS(text, bookLanguage);
  const stt = useWorldSTT(bookLanguage);
  const [heard, setHeard] = useState(false);

  // Nothing to render when both flags are off — the common case.
  if (!WORLD_TTS_ENABLED && !(WORLD_VOICE_INPUT_ENABLED && stt.supported)) {
    return null;
  }

  const handleHear = () => {
    if (tts.speaking) { tts.stop(); return; }
    setHeard(true);
    void tts.speak();
  };

  const handleSpeak = () => {
    if (stt.listening) { stt.stop(); return; }
    stt.start((transcript) => {
      // Feed the spoken question to the LLM ask-character flow. When no
      // key is configured, fireLlmAsk is a no-op — the deterministic
      // reply stays and the transcript is shown as an acknowledgement.
      onSpokenAsk(transcript);
    });
  };

  return (
    <>
      {WORLD_TTS_ENABLED && (
        <button
          type="button"
          className="btn-secondary"
          onClick={handleHear}
          style={{ borderRadius: 999 }}
          aria-label={tts.speaking ? 'Stop voice' : 'Hear this reply spoken'}
        >
          {tts.speaking ? '⏹ Stop voice' : '🔊 Hear'}
        </button>
      )}
      {WORLD_VOICE_INPUT_ENABLED && stt.supported && (
        <button
          type="button"
          className="btn-secondary"
          onClick={handleSpeak}
          style={{ borderRadius: 999 }}
          aria-label={stt.listening ? 'Stop listening' : 'Speak your question'}
        >
          {stt.listening ? '⏹ Listening…' : '🎤 Speak'}
        </button>
      )}
      {WORLD_TTS_ENABLED && heard && !llmAvailable && (
        <p style={{ fontSize: '0.72rem', opacity: 0.45, margin: '4px 0 0', flexBasis: '100%' }}>
          Voiced via your browser&apos;s built-in speech. Set a TTS key (Sarvam/Gemini) for warmer per-character voices.
        </p>
      )}
    </>
  );
}