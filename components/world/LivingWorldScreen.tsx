'use client';

// ============================================================
// KathaKitaab — Living World Screen
//
// Owns the world: fetches the book payload, synthesizes the
// WorldManifest (pure, client-side, offline-capable), runs the
// session reducer, and wires the stage + mission panel + overlays
// (narration payoff, NPC speech, reflection quiz, hints).
//
// All session state is hydrated inside the async load effect (after
// `await fetch`) — never via synchronous setState in an effect body —
// matching the PlayModeScreen pattern and the repo's strict
// react-hooks rules.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import WorldStage from '@/components/world/WorldStage';
import WorldA11yLayer from '@/components/world/WorldA11yLayer';
import MissionPanel from '@/components/world/MissionPanel';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import { useWebglAvailable } from '@/lib/hooks/useWebglAvailable';
import { synthesizeWorldManifest, replyFor, WORLD_WIDTH, WORLD_HEIGHT, type WorldManifest, type WorldMission, type WorldNpc, type WorldPortal, type WorldIdentity } from '@/lib/world/worldManifest';
import { useWorldTTS, useWorldSTT, WORLD_TTS_ENABLED, WORLD_VOICE_INPUT_ENABLED } from '@/components/world/useWorldVoice';

// Lazy-load the WebGL canvas. `ssr:false` is only legal inside a Client
// Component (this file is `'use client'`) — Next 16 rejects it in a
// Server Component. See node_modules/next/dist/docs/01-app/02-guides/
// lazy-loading.md. The canvas is feature-gated by
// NEXT_PUBLIC_KK_WORLD_3D; when off (or WebGL unavailable) we render
// the v1 DOM stage instead, which is also the e2e + fallback path.
const World3DCanvas = dynamic(() => import('@/components/world3d/World3DCanvas'), {
  ssr: false,
  loading: () => (
    // Distinct class — must NOT reuse `.world-viewport`, else the
    // loading spinner + the outer wrapper both match `.world-viewport`
    // and Playwright's strict mode sees two elements during chunk load.
    <div className="world3d-loading">
      <div className="world-spinner" />
    </div>
  ),
});

// Base build never touches WebGL unless the flag is explicitly enabled.
// Defaults to on; opt out with NEXT_PUBLIC_KK_WORLD_3D=0.
const WORLD_3D_ENABLED = process.env.NEXT_PUBLIC_KK_WORLD_3D !== '0';
import {
  clearWorldSession,
  createInitialSession,
  loadWorldSession,
  reduceWorldSession,
  saveWorldSession,
  type WorldSessionAction,
  type WorldSessionState,
} from '@/lib/world/worldSession';
import type { Book, Character, Scene } from '@/lib/types/livebook';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';

interface BookPayload {
  // The /api/books/[slug] envelope returns the Book plus a few
  // GeneratedBook-only fields the World engine consumes. They're
  // optional (absent on the Ramayana seed + legacy books) — the
  // synthesizer falls back to the deterministic universal lexicon.
  book: Book & { worldIdentity?: WorldIdentity; language?: string };
  scenes: Scene[];
  characters: Character[];
}

type Overlay =
  | { kind: 'narration'; nodeId: string }
  | { kind: 'speech'; npc: WorldNpc; dialogTurn: number; llmReply: string | null; llmLoading: boolean }
  | { kind: 'clue'; mission: WorldMission }
  | { kind: 'quiz'; mission: WorldMission; selected: number | null; feedback: string | null; correct: boolean }
  | { kind: 'hint'; text: string }
  | null;

interface Props {
  bookSlug: string;
  /** W3 — optional uint32 seed override for reproducible planets. */
  seedOverride?: number;
}

// Ambient biome audio is opt-in (default OFF) so a fresh visit never
// surprises the user with sound. Uses NEXT_PUBLIC_ since it's read
// client-side.
const WORLD_AUDIO_ENABLED = process.env.NEXT_PUBLIC_KATHA_WORLD_AUDIO === '1';

// Lazy-load the ambient audio engine only when the flag is on so the
// base bundle stays lean.
const WorldAudioEngine = dynamic(() => import('@/lib/audio/worldAudioEngine').then(m => m.WorldAudioEngine), {
  ssr: false,
});

export default function LivingWorldScreen({ bookSlug, seedOverride }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  // WebGL presence is only knowable on the client. useSyncExternalStore
  // returns false during SSR + on the first client render, then re-renders
  // with the real capability — so a headless / WebGL-less browser falls
  // back to the v1 DOM stage (and the e2e suite) instead of crashing,
  // with no setState-in-effect.
  const webglAvailable = useWebglAvailable();
  const use3D = WORLD_3D_ENABLED && webglAvailable;
  const [manifest, setManifest] = useState<WorldManifest | null>(null);
  const [session, setSession] = useState<WorldSessionState | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // Book-level narration language (hi/en/auto) — drives TTS voice + STT
  // recognition lang for the World speech flow. Absent on the seed + legacy
  // books → 'auto' (TTS auto-detects, STT defaults to en-US).
  const [bookLanguage, setBookLanguage] = useState<string | undefined>(undefined);
  // Remounts the stage on reset so the avatar re-spawns cleanly
  // without a synchronous setState-in-effect sync.
  const [resetNonce, setResetNonce] = useState(0);

  // Latest session mirror for event handlers that need to read
  // current state without making their useCallback dep on `session`
  // (which would recreate them every avatar frame).
  const sessionRef = useRef<WorldSessionState | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // ---- Load book + synthesize manifest + hydrate session ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('loading');
      setError('');
      try {
        const res = await fetch(`/api/books/${bookSlug}`);
        const json = (await res.json()) as BookPayload | { error?: string };
        if (!res.ok || !('book' in json)) {
          throw new Error(('error' in json && json.error) || 'This story world is not ready yet.');
        }
        if (cancelled) return;
        const m = synthesizeWorldManifest(json.book, json.scenes, json.characters, seedOverride, json.book.worldIdentity);
        setManifest(m);
        setBookLanguage(json.book.language);
        const stored = loadWorldSession(bookSlug);
        if (
          stored &&
          stored.bookSlug === bookSlug &&
          m.nodes.some(n => n.id === stored.currentNodeId)
        ) {
          setSession(stored);
        } else {
          setSession(createInitialSession(m));
        }
        setPhase('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open this story world.');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookSlug, seedOverride]);

  // ---- Session dispatch helper (pure updater; persistence is a
  //      separate effect below, so the setState updater stays clean) ----
  const apply = useCallback(
    (action: WorldSessionAction) => {
      setSession(prev => {
        if (!prev || !manifest) return prev;
        return reduceWorldSession(prev, action, manifest);
      });
    },
    [manifest],
  );

  // Persist to localStorage whenever the session changes (initial
  // create, every action, reset). This is the external-store sync the
  // react-hooks rules expect an effect to do — no setState here.
  useEffect(() => {
    if (session) saveWorldSession(session);
  }, [session]);

  // ---- Stage callbacks ----
  const handleArriveNode = useCallback(
    (nodeId: string) => {
      apply({ type: 'VISIT_NODE', nodeId });
    },
    [apply],
  );

  const handleArrivePortal = useCallback(
    (portal: WorldPortal) => {
      const s = sessionRef.current;
      if (!s || !manifest) return;
      const delivered = s.completedMissionIds.includes(`mf-${portal.fromNodeId}`);
      if (delivered) {
        setOverlay({ kind: 'hint', text: 'This portal is already open — walk to the next scene.' });
        return;
      }
      if (s.carriedFragmentNodeId === portal.fromNodeId) {
        apply({ type: 'DELIVER_FRAGMENT', fromNodeId: portal.fromNodeId });
        setOverlay({ kind: 'narration', nodeId: portal.fromNodeId });
        return;
      }
      const fromNode = manifest.nodes.find(n => n.id === portal.fromNodeId);
      setOverlay({
        kind: 'hint',
        text: `Carry ${fromNode?.title ?? 'this scene'}'s story fragment to the portal first.`,
      });
    },
    [apply, manifest],
  );

  const handleSetAvatar = useCallback(
    (x: number, y: number, lat?: number, lon?: number) => {
      apply({ type: 'SET_AVATAR', x, y, lat, lon });
    },
    [apply],
  );

  // 3D click-to-move: the raycast gave us a lat/lon on the planet but no
  // flat-projected x/y. Project it equirectangularly so the v1 fields stay
  // consistent with the v1 fallback stage + a11y layer (both read x/y).
  // Mirrors projectFlat() in worldManifest.ts (PAD_X=96, PAD_Y=78).
  const handleMoveTo = useCallback(
    (lat: number, lon: number) => {
      const PAD_X = 96, PAD_Y = 78;
      const usableW = WORLD_WIDTH - 2 * PAD_X;
      const usableH = WORLD_HEIGHT - 2 * PAD_Y;
      const x = Math.max(PAD_X, Math.min(WORLD_WIDTH - PAD_X, WORLD_WIDTH / 2 + (lon / Math.PI) * (usableW / 2)));
      const y = Math.max(PAD_Y, Math.min(WORLD_HEIGHT - PAD_Y, WORLD_HEIGHT / 2 - (lat / (Math.PI / 2)) * (usableH / 2)));
      apply({ type: 'SET_AVATAR', x, y, lat, lon });
    },
    [apply],
  );

  // W2 — read the per-NPC dialogue turn from the persisted livingMemory blob.
  const dialogTurnFor = useCallback((npcSlug: string): number => {
    const s = sessionRef.current;
    if (!s?.livingMemory) return 0;
    const turns = (s.livingMemory as Record<string, Record<string, number>>).dialogTurns;
    return turns?.[npcSlug] ?? 0;
  }, []);

  const handleSpeakNpc = useCallback((npc: WorldNpc) => {
    const turn = dialogTurnFor(npc.slug);
    setOverlay({ kind: 'speech', npc, dialogTurn: turn, llmReply: null, llmLoading: false });
  }, [dialogTurnFor]);

  const handleCollectClue = useCallback(
    (missionId: string) => {
      const s = sessionRef.current;
      if (!s || !manifest) return;
      const node = manifest.nodes.find(n => n.id === s.currentNodeId);
      const mission = node?.missions.find(m => m.id === missionId);
      if (!mission || s.completedMissionIds.includes(missionId)) return;
      apply({ type: 'COMPLETE_MISSION', missionId, rewardXP: mission.rewardXP });
      setOverlay({ kind: 'clue', mission });
    },
    [apply, manifest],
  );

  // Fire an ask-character LLM call with an arbitrary question. Shared by
  // the mission "Ask character" path (canned question) and the STT path
  // (spoken question). Both gate on isOpenAIConfigured() + bookSlug; when
  // no key is configured this is a no-op and the deterministic replyFor
  // reply already shown stays on screen. threadId gives the character
  // memory across turns (S1).
  const fireLlmAsk = useCallback(
    (npc: WorldNpc, question: string) => {
      const s = sessionRef.current;
      if (!s || !isOpenAIConfigured() || !bookSlug) return;
      const turn = dialogTurnFor(npc.slug);
      setOverlay({ kind: 'speech', npc, dialogTurn: turn, llmReply: null, llmLoading: true });
      const threadId = `${s.bookSlug}:${npc.slug}`;
      fetch('/api/livebook/ask-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookSlug,
          sceneId: s.currentNodeId,
          characterSlug: npc.slug,
          question,
          mode: 'canon',
          threadId,
        }),
      })
        .then(res => res.ok ? res.json() : Promise.reject(new Error(`ask-character → ${res.status}`)))
        .then((data: { answer?: string }) => {
          setOverlay({ kind: 'speech', npc, dialogTurn: turn, llmReply: data.answer ?? null, llmLoading: false });
        })
        .catch(() => {
          // Graceful fallback: keep the deterministic reply already shown.
          setOverlay({ kind: 'speech', npc, dialogTurn: turn, llmReply: null, llmLoading: false });
        });
    },
    [bookSlug, dialogTurnFor],
  );

  const handleAskCharacter = useCallback(
    (mission: WorldMission) => {
      const s = sessionRef.current;
      if (!s || !manifest) return;
      if (s.completedMissionIds.includes(mission.id)) return;
      apply({ type: 'COMPLETE_MISSION', missionId: mission.id, rewardXP: mission.rewardXP });
      const npc = manifest.npcs.find(n => n.slug === mission.characterSlug);
      if (!npc) return;
      const turn = dialogTurnFor(npc.slug);
      // Show the deterministic reply for the current turn. The "Ask again"
      // button (onAdvanceDialog) dispatches ADVANCE_DIALOG to bump the
      // persisted turn and cycle to the next reply.
      setOverlay({ kind: 'speech', npc, dialogTurn: turn, llmReply: null, llmLoading: false });

      // W2 LLM opt-in: when OpenAI is configured, call the ask-character
      // route with a threadId so the character remembers across turns.
      // Default (no key) → deterministic replyFor already shown.
      fireLlmAsk(npc, 'Tell me more about your side of the story.');
    },
    [apply, manifest, fireLlmAsk, dialogTurnFor],
  );

  // STT path: a spoken question (captured by useWorldSTT in SpeechBody)
  // re-fires the ask-character LLM flow with that question. When no key
  // is configured this is a no-op — the spoken question is acknowledged
  // by the UI but the deterministic reply stays.
  const handleSpokenAsk = useCallback(
    (npc: WorldNpc, question: string) => {
      fireLlmAsk(npc, question);
    },
    [fireLlmAsk],
  );

  const handleAnswerQuiz = useCallback((mission: WorldMission) => {
    setOverlay({ kind: 'quiz', mission, selected: null, feedback: null, correct: false });
  }, []);

  const handleQuizSelect = useCallback(
    (mission: WorldMission, optionIndex: number) => {
      const quiz = mission.quiz;
      if (!quiz) return;
      const correct = optionIndex === quiz.correctAnswer;
      if (correct) {
        const s = sessionRef.current;
        if (s && manifest && !s.completedMissionIds.includes(mission.id)) {
          apply({ type: 'COMPLETE_MISSION', missionId: mission.id, rewardXP: mission.rewardXP });
        }
      }
      setOverlay({
        kind: 'quiz',
        mission,
        selected: optionIndex,
        feedback: correct ? `Correct. ${quiz.explanation}` : `Not quite. ${quiz.explanation}`,
        correct,
      });
    },
    [apply, manifest],
  );

  const handleReset = useCallback(() => {
    if (!manifest) return;
    clearWorldSession(bookSlug);
    setOverlay(null);
    setSession(createInitialSession(manifest));
    setResetNonce(n => n + 1);
  }, [bookSlug, manifest]);

  // Escape closes any overlay.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  // ---- Render ----
  if (phase === 'loading' || !manifest || !session) {
    return (
      <main className="world-page" style={{ minHeight: '100vh' }}>
        <div className="world-loading">
          <div className="world-spinner" />
          <p>Opening the living world…</p>
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="world-page" style={{ minHeight: '100vh' }}>
        <div className="glass-card world-error">
          <h1 className="font-serif">Living World Not Ready</h1>
          <p>{error}</p>
          <div className="world-error-actions">
            <Link href={`/books/${bookSlug}`} className="btn-secondary" style={{ textDecoration: 'none' }}>Read mode</Link>
            <Link href="/books" className="btn-secondary" style={{ textDecoration: 'none' }}>Library</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="world-page">
      <header className="world-header">
        <Link href={`/books/${bookSlug}`} className="btn-secondary world-back" style={{ textDecoration: 'none', borderRadius: 999 }}>
          ← Read mode
        </Link>
        <div className="world-header-title">
          <div className="world-header-eyebrow">Living World Mode</div>
          <div className="font-serif world-header-h1">{manifest.bookTitle}</div>
        </div>
        <Link href="/books" className="btn-secondary world-back" style={{ textDecoration: 'none', borderRadius: 999 }}>
          Library
        </Link>
      </header>

      {use3D ? (
        <div className="world-viewport world-stage-3d" key={resetNonce}>
          <World3DCanvas
            manifest={manifest}
            session={session}
            reducedMotion={reducedMotion}
            onMoveTo={handleMoveTo}
          />
          {/* The DOM accessibility/mirror layer is the canonical
              interaction + screen-reader surface and carries the exact
              data-* hooks the Playwright e2e spec asserts, so the 3D
              rewrite stays green without touching the spec. */}
          <WorldA11yLayer
            manifest={manifest}
            session={session}
            onArriveNode={handleArriveNode}
            onArrivePortal={handleArrivePortal}
            onSetAvatar={handleSetAvatar}
            onSpeakNpc={handleSpeakNpc}
            onCollectClue={handleCollectClue}
          />
        </div>
      ) : (
        <WorldStage
          key={resetNonce}
          manifest={manifest}
          session={session}
          onArriveNode={handleArriveNode}
          onArrivePortal={handleArrivePortal}
          onSetAvatar={handleSetAvatar}
          onSpeakNpc={handleSpeakNpc}
          onCollectClue={handleCollectClue}
        />
      )}

      <MissionPanel
        manifest={manifest}
        session={session}
        onAskCharacter={handleAskCharacter}
        onAnswerQuiz={handleAnswerQuiz}
        onReset={handleReset}
      />

      {/* W1 — ambient biome audio. Opt-in (NEXT_PUBLIC_KATHA_WORLD_AUDIO=1)
          AND only in the 3D path so the v1 DOM fallback stays silent.
          Headless/no-AudioContext → no-op inside the engine. */}
      {use3D && WORLD_AUDIO_ENABLED && manifest && session && (
        <WorldAudioEngine manifest={manifest} session={session} />
      )}

      {overlay && (
        <WorldOverlay
          overlay={overlay}
          manifest={manifest}
          onClose={() => setOverlay(null)}
          onQuizSelect={handleQuizSelect}
          onAdvanceDialog={(npc) => {
            // Advance the persisted turn (for next session restore) and
            // bump the local overlay turn. We compute nextTurn from the
            // overlay's current dialogTurn + 1 (not from the session ref)
            // because the ref hasn't updated yet after the dispatch.
            apply({ type: 'ADVANCE_DIALOG', npcSlug: npc.slug });
            const currentTurn = overlay.kind === 'speech' ? overlay.dialogTurn : 0;
            const nextTurn = currentTurn + 1;
            setOverlay({ kind: 'speech', npc, dialogTurn: nextTurn, llmReply: null, llmLoading: false });
          }}
          onSpokenAsk={handleSpokenAsk}
          bookLanguage={bookLanguage}
          llmAvailable={isOpenAIConfigured()}
        />
      )}
    </main>
  );
}

// ---- Overlay renderer ----

function WorldOverlay({
  overlay,
  manifest,
  onClose,
  onQuizSelect,
  onAdvanceDialog,
  onSpokenAsk,
  bookLanguage,
  llmAvailable,
}: {
  overlay: Exclude<Overlay, null>;
  manifest: WorldManifest;
  onClose: () => void;
  onQuizSelect: (mission: WorldMission, optionIndex: number) => void;
  onAdvanceDialog: (npc: WorldNpc) => void;
  onSpokenAsk: (npc: WorldNpc, question: string) => void;
  bookLanguage?: string;
  llmAvailable: boolean;
}) {
  return (
    <div className="world-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="world-overlay-card" onClick={e => e.stopPropagation()} data-world-overlay={overlay.kind}>
        {overlay.kind === 'narration' && <NarrationBody manifest={manifest} nodeId={overlay.nodeId} onClose={onClose} />}
        {overlay.kind === 'speech' && (
          <SpeechBody
            npc={overlay.npc}
            dialogTurn={overlay.dialogTurn}
            llmReply={overlay.llmReply}
            llmLoading={overlay.llmLoading}
            llmAvailable={llmAvailable}
            bookLanguage={bookLanguage}
            onClose={onClose}
            onAdvance={() => onAdvanceDialog(overlay.npc)}
            onSpokenAsk={(question) => onSpokenAsk(overlay.npc, question)}
          />
        )}
        {overlay.kind === 'clue' && (
          <div className="world-speech">
            <div className="world-speech-name">🔎 A clue</div>
            <p className="world-speech-text">{overlay.mission.clueText ?? overlay.mission.description}</p>
            <button type="button" className="btn-primary" onClick={onClose} style={{ borderRadius: 999 }}>Keep exploring</button>
          </div>
        )}
        {overlay.kind === 'hint' && (
          <div className="world-speech">
            <div className="world-speech-name">🧭 The way</div>
            <p className="world-speech-text">{overlay.text}</p>
            <button type="button" className="btn-secondary" onClick={onClose} style={{ borderRadius: 999 }}>Okay</button>
          </div>
        )}
        {overlay.kind === 'quiz' && (
          <div className="world-quiz">
            <div className="world-speech-name">🔮 Reflection</div>
            <p className="world-quiz-question">{overlay.mission.description}</p>
            <div className="world-quiz-options">
              {overlay.mission.quiz?.options.map((opt, i) => {
                const selected = overlay.selected === i;
                const showCorrect = overlay.selected !== null && i === overlay.mission.quiz!.correctAnswer;
                const showWrong = selected && !overlay.correct;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`world-quiz-option ${selected ? 'is-selected' : ''} ${showCorrect ? 'is-correct' : ''} ${showWrong ? 'is-wrong' : ''}`}
                    disabled={overlay.correct}
                    onClick={() => onQuizSelect(overlay.mission, i)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {overlay.feedback && <p className="world-quiz-feedback">{overlay.feedback}</p>}
            {overlay.correct && (
              <button type="button" className="btn-primary" onClick={onClose} style={{ borderRadius: 999, marginTop: 12 }}>Continue</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- W2 speech body (deterministic replies + LLM opt-in) ----
// Plus voice: "Hear" speaks the reply (TTS route → speechSynthesis fallback),
// "Speak" captures a spoken question via browser STT and re-fires the
// ask-character LLM flow with it. Both gated by NEXT_PUBLIC_KATHA_WORLD_TTS /
// NEXT_PUBLIC_KATHA_WORLD_VOICE_INPUT (default OFF) — the no-key/no-flag
// path shows text replies only, which is the honest base experience.

function SpeechBody({
  npc,
  dialogTurn,
  llmReply,
  llmLoading,
  llmAvailable,
  bookLanguage,
  onClose,
  onAdvance,
  onSpokenAsk,
}: {
  npc: WorldNpc;
  dialogTurn: number;
  llmReply: string | null;
  llmLoading: boolean;
  llmAvailable: boolean;
  bookLanguage?: string;
  onClose: () => void;
  onAdvance: () => void;
  onSpokenAsk: (question: string) => void;
}) {
  const deterministicReply = replyFor(npc, dialogTurn);
  const text = llmReply ?? deterministicReply;

  const tts = useWorldTTS(text, bookLanguage);
  const stt = useWorldSTT(bookLanguage);
  const [heard, setHeard] = useState(false);

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
    <div className="world-speech">
      <div className="world-speech-name">{npc.emoji} {npc.name}</div>
      <p className="world-speech-text">{text}</p>
      {llmLoading && <p style={{ fontSize: '0.78rem', opacity: 0.6, margin: '4px 0 8px' }}>Thinking…</p>}
      {stt.listening && (
        <p style={{ fontSize: '0.78rem', opacity: 0.7, margin: '4px 0 8px' }}>🎤 Listening… speak your question.</p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!llmLoading && (
          <button type="button" className="btn-secondary" onClick={onAdvance} style={{ borderRadius: 999 }}>
            Ask again
          </button>
        )}
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
        <button type="button" className="btn-primary" onClick={onClose} style={{ borderRadius: 999 }}>
          {llmLoading ? 'Continue' : 'Done'}
        </button>
      </div>
      {!llmAvailable && (
        <p style={{ fontSize: '0.72rem', opacity: 0.45, margin: '6px 0 0' }}>
          Deterministic replies. Set OPENAI_API_KEY for in-character LLM dialogue.
        </p>
      )}
      {WORLD_TTS_ENABLED && heard && !llmAvailable && (
        <p style={{ fontSize: '0.72rem', opacity: 0.45, margin: '4px 0 0' }}>
          Voiced via your browser&apos;s built-in speech. Set a TTS key (Sarvam/Gemini) for warmer per-character voices.
        </p>
      )}
    </div>
  );
}

function NarrationBody({ manifest, nodeId, onClose }: { manifest: WorldManifest; nodeId: string; onClose: () => void }) {
  const node = manifest.nodes.find(n => n.id === nodeId);
  const mission = node?.missions.find(m => m.kind === 'deliver_fragment');
  return (
    <div className="world-narration" data-world-narration={nodeId}>
      {node?.bgImageUrl && (
        <div className="world-narration-bg" style={{ backgroundImage: `url(${node.bgImageUrl})` }} aria-hidden />
      )}
      <div className="world-narration-body">
        <div className="world-narration-eyebrow">Story fragment delivered · {node?.title}</div>
        <p className="world-narration-text">{mission?.fragmentText ?? node?.title}</p>
        <button type="button" className="btn-primary" onClick={onClose} style={{ borderRadius: 999 }}>Walk on</button>
      </div>
    </div>
  );
}