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
import Link from 'next/link';
import WorldStage from '@/components/world/WorldStage';
import MissionPanel from '@/components/world/MissionPanel';
import { synthesizeWorldManifest, type WorldManifest, type WorldMission, type WorldNpc, type WorldPortal } from '@/lib/world/worldManifest';
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

interface BookPayload {
  book: Book;
  scenes: Scene[];
  characters: Character[];
}

type Overlay =
  | { kind: 'narration'; nodeId: string }
  | { kind: 'speech'; npc: WorldNpc }
  | { kind: 'clue'; mission: WorldMission }
  | { kind: 'quiz'; mission: WorldMission; selected: number | null; feedback: string | null; correct: boolean }
  | { kind: 'hint'; text: string }
  | null;

interface Props {
  bookSlug: string;
}

export default function LivingWorldScreen({ bookSlug }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<WorldManifest | null>(null);
  const [session, setSession] = useState<WorldSessionState | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
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
        const m = synthesizeWorldManifest(json.book, json.scenes, json.characters);
        setManifest(m);
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
  }, [bookSlug]);

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
    (x: number, y: number) => {
      apply({ type: 'SET_AVATAR', x, y });
    },
    [apply],
  );

  const handleSpeakNpc = useCallback((npc: WorldNpc) => {
    setOverlay({ kind: 'speech', npc });
  }, []);

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

  const handleAskCharacter = useCallback(
    (mission: WorldMission) => {
      const s = sessionRef.current;
      if (!s || !manifest) return;
      if (s.completedMissionIds.includes(mission.id)) return;
      apply({ type: 'COMPLETE_MISSION', missionId: mission.id, rewardXP: mission.rewardXP });
      const npc = manifest.npcs.find(n => n.slug === mission.characterSlug);
      if (npc) setOverlay({ kind: 'speech', npc });
    },
    [apply, manifest],
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

      <MissionPanel
        manifest={manifest}
        session={session}
        onAskCharacter={handleAskCharacter}
        onAnswerQuiz={handleAnswerQuiz}
        onReset={handleReset}
      />

      {overlay && (
        <WorldOverlay
          overlay={overlay}
          manifest={manifest}
          onClose={() => setOverlay(null)}
          onQuizSelect={handleQuizSelect}
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
}: {
  overlay: Exclude<Overlay, null>;
  manifest: WorldManifest;
  onClose: () => void;
  onQuizSelect: (mission: WorldMission, optionIndex: number) => void;
}) {
  return (
    <div className="world-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="world-overlay-card" onClick={e => e.stopPropagation()} data-world-overlay={overlay.kind}>
        {overlay.kind === 'narration' && <NarrationBody manifest={manifest} nodeId={overlay.nodeId} onClose={onClose} />}
        {overlay.kind === 'speech' && (
          <div className="world-speech">
            <div className="world-speech-name">{overlay.npc.emoji} {overlay.npc.name}</div>
            <p className="world-speech-text">{overlay.npc.idlePhrase}</p>
            <button type="button" className="btn-primary" onClick={onClose} style={{ borderRadius: 999 }}>Continue</button>
          </div>
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