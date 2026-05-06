'use client';

import { useCallback, useEffect, useMemo, useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import type { Book, Character, Scene, SceneWithHotspots } from '@/lib/types/livebook';
import type { GameState } from '@/lib/game/gameState';
import { buildDefaultActions, TOOL_METADATA, type AvailableAction } from '@/lib/game/worldMasterAgent';
import CharacterSelectScreen, { type PlayableCharacter } from '@/components/game/CharacterSelectScreen';
import SceneViewer from '@/components/livebook/SceneViewer';
import {
  bootstrapPlaySession,
  clearPlaySession,
  ensureSceneInPlaySession,
  loadPlaySession,
  savePlaySession,
  updatePlaySessionGameState,
  type PlaySessionState,
} from '@/lib/game/playSessionState';
import type { PlayActionResult } from '@/lib/game/playActionResolver';

interface PlayBookPayload {
  book: Book;
  scenes: Scene[];
  characters: Character[];
}

interface Props {
  bookSlug: string;
}

function selectStoryActions(actions: AvailableAction[]): AvailableAction[] {
  const continueAction = actions.find(action => action.id === 'continue');
  const examineAction = actions.find(action => action.type === 'EXAMINE');
  const talkAction = actions.find(action => action.type === 'TALK');
  const createAction = actions.find(action => action.type === 'CREATE');

  return [continueAction, talkAction, examineAction, createAction].filter((action): action is AvailableAction => Boolean(action));
}

function isSceneUnlocked(scene: Scene, index: number, scenes: Scene[], visitedSceneIds: Set<string>): boolean {
  if (index === 0) return true;
  if (visitedSceneIds.has(scene.scene_id)) return true;

  const previousScene = scenes[index - 1];
  return previousScene ? visitedSceneIds.has(previousScene.scene_id) : false;
}

function getStoryToolLabel(toolId: string): string | null {
  const tool = TOOL_METADATA[toolId];
  if (!tool) return null;

  switch (tool.realFunction) {
    case 'narrate':
      return 'Read aloud';
    case 'generate-image':
      return 'Illustration';
    case 'translate':
      return 'Translate';
    case 'save':
      return 'Save this moment';
    case 'comic':
      return 'Comic page';
    case 'research':
      return 'Deeper context';
    case 'quiz':
      return 'Reflection prompt';
    case 'share':
      return 'Share';
    default:
      return null;
  }
}

function getSceneCharacterSlugs(scene: Pick<SceneWithHotspots, 'hotspots'> | null): string[] {
  if (!scene) return [];

  return scene.hotspots
    .filter(hotspot => hotspot.target_type === 'character')
    .map(hotspot => hotspot.target_id);
}

export default function PlayModeScreen({ bookSlug }: Props) {
  const router = useRouter();
  const [payload, setPayload] = useState<PlayBookPayload | null>(null);
  const [session, setSession] = useState<PlaySessionState | null>(null);
  const [currentScene, setCurrentScene] = useState<SceneWithHotspots | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [pendingAction, setPendingAction] = useState<AvailableAction | null>(null);
  const [pendingInput, setPendingInput] = useState('');
  const [isStoryMenuOpen, setIsStoryMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBook() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/books/${bookSlug}`);
        const json = (await response.json()) as PlayBookPayload | { error?: string };

        if (!response.ok || !('book' in json)) {
          throw new Error(('error' in json && json.error) || 'Unable to open this story world.');
        }

        if (cancelled) return;

        setPayload(json);

        const storedSession = loadPlaySession(bookSlug);
        if (storedSession?.selectedCharacter) {
          const fallbackScene = json.scenes.find(scene => scene.scene_id === storedSession.currentSceneId) ?? json.scenes[0];
          const syncedSession = savePlaySession(
            ensureSceneInPlaySession(storedSession, {
              sceneId: fallbackScene.scene_id,
              sceneTitle: fallbackScene.title,
              sceneOrder: fallbackScene.order_index,
              totalChapters: json.scenes.length,
              nearbyCharacterSlugs: [],
            })
          );
          setSession(syncedSession);
        } else {
          setSession(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to open this story world.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBook();

    return () => {
      cancelled = true;
    };
  }, [bookSlug]);

  const currentSceneSummary = useMemo(() => {
    if (!payload || !session) return null;
    return payload.scenes.find(scene => scene.scene_id === session.currentSceneId) ?? payload.scenes[0] ?? null;
  }, [payload, session]);

  const nearbyCharacterSlugs = useMemo(() => getSceneCharacterSlugs(currentScene), [currentScene]);

  const actions = useMemo(() => {
    if (!session) return [];
    return buildDefaultActions(session.worldState, nearbyCharacterSlugs, session.unlockedTools);
  }, [nearbyCharacterSlugs, session]);

  const visibleActions = useMemo(() => selectStoryActions(actions), [actions]);

  const currentQuest = useMemo(() => {
    if (!session) return null;
    return session.questState.activeQuests.find(quest => quest.sceneId === session.currentSceneId) ?? null;
  }, [session]);

  const presentCharacters = useMemo(() => {
    if (!payload) return [];
    return payload.characters.filter(character => nearbyCharacterSlugs.includes(character.slug));
  }, [nearbyCharacterSlugs, payload]);

  const visitedSceneIds = useMemo(() => new Set(session?.gameState.scenesVisited ?? []), [session?.gameState.scenesVisited]);

  const quietTools = useMemo(() => {
    if (!session) return [];

    return Array.from(new Set(
      session.unlockedTools
        .map(getStoryToolLabel)
        .filter((label): label is string => Boolean(label))
    ));
  }, [session]);

  const persistSession = useCallback((updater: (previous: PlaySessionState) => PlaySessionState) => {
    setSession(previous => {
      if (!previous) return previous;
      return savePlaySession(updater(previous));
    });
  }, []);

  const handleSceneChange = useCallback((scene: SceneWithHotspots) => {
    if (!payload) return;

    setCurrentScene(scene);

    persistSession(previous =>
      ensureSceneInPlaySession(previous, {
        sceneId: scene.scene_id,
        sceneTitle: scene.title,
        sceneOrder: scene.order_index,
        totalChapters: payload.scenes.length,
        nearbyCharacterSlugs: getSceneCharacterSlugs(scene),
      })
    );
  }, [payload, persistSession]);

  const handleGameStateChange = useCallback((gameState: GameState) => {
    persistSession(previous => updatePlaySessionGameState(previous, gameState));
  }, [persistSession]);

  const handleCharacterSelect = useCallback((character: PlayableCharacter) => {
    if (!payload || payload.scenes.length === 0) return;

    const firstScene = payload.scenes[0];
    const nextSession = bootstrapPlaySession({
      bookSlug,
      ageBand: 'youth',
      selectedCharacter: character,
      sceneId: firstScene.scene_id,
      sceneTitle: firstScene.title,
      sceneOrder: firstScene.order_index,
      totalChapters: payload.scenes.length,
      nearbyCharacterSlugs: [],
    });

    startTransition(() => {
      setCurrentScene(null);
      setSession(nextSession);
      setPendingAction(null);
      setPendingInput('');
    });
  }, [bookSlug, payload]);

  const handleSceneSelect = useCallback((sceneId: string) => {
    if (!payload) return;

    const nextScene = payload.scenes.find(scene => scene.scene_id === sceneId);
    if (!nextScene) return;

    persistSession(previous =>
      ensureSceneInPlaySession(previous, {
        sceneId: nextScene.scene_id,
        sceneTitle: nextScene.title,
        sceneOrder: nextScene.order_index,
        totalChapters: payload.scenes.length,
        nearbyCharacterSlugs: [],
      })
    );
  }, [payload, persistSession]);

  const handleActionSelect = useCallback(async (action: AvailableAction, userInput?: string) => {
    if (!payload || !currentSceneSummary || !session) return;

    setIsProcessingAction(true);

    try {
      if (action.type === 'MOVE' && action.id === 'continue' && currentSceneSummary.next_scene_id) {
        handleSceneSelect(currentSceneSummary.next_scene_id);
        return;
      }

      if (action.type === 'MOVE') return;

      const response = await fetch('/api/play/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookSlug,
          sceneId: currentSceneSummary.scene_id,
          sceneTitle: currentSceneSummary.title,
          sceneNarration: currentSceneSummary.narration,
          selectedCharacter: session.selectedCharacter,
          action: {
            type: action.type,
            label: action.label,
            targetId: action.targetId,
            userInput,
          },
          ageBand: session.ageBand,
          gameState: session.gameState,
          worldState: session.worldState,
          questState: session.questState,
          unlockedTools: session.unlockedTools,
          nearbyCharacterSlugs,
        }),
      });

      const result = (await response.json()) as PlayActionResult | { error?: string };
      if (!response.ok || !('updatedGameState' in result)) {
        throw new Error(('error' in result && result.error) || 'The Story Master could not resolve that action.');
      }

      persistSession(previous => ({
        ...previous,
        gameState: result.updatedGameState,
        worldState: result.updatedWorldState,
        questState: result.updatedQuestState,
        unlockedTools: result.unlockedTools,
      }));

      setPendingAction(null);
      setPendingInput('');
    } catch {
      setPendingAction(null);
      setPendingInput('');
    } finally {
      setIsProcessingAction(false);
    }
  }, [bookSlug, currentSceneSummary, handleSceneSelect, nearbyCharacterSlugs, payload, persistSession, session]);

  const handleResetCharacter = useCallback(() => {
    clearPlaySession(bookSlug);
    setCurrentScene(null);
    setSession(null);
    setPendingAction(null);
    setPendingInput('');
  }, [bookSlug]);

  if (loading) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64,
            height: 64,
            margin: '0 auto 20px',
            borderRadius: '50%',
            border: '3px solid rgba(255,215,0,0.15)',
            borderTopColor: 'var(--color-gold)',
            animation: 'spin 1.4s linear infinite',
          }} />
          <p style={{ color: 'var(--color-gold)', fontWeight: 600 }}>Opening the story world...</p>
        </div>
      </main>
    );
  }

  if (error || !payload) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="glass-card" style={{ width: 'min(560px, 100%)', padding: 32, textAlign: 'center' }}>
          <h1 className="font-serif" style={{ margin: 0, color: 'var(--color-gold-light)' }}>Play Mode Not Ready</h1>
          <p style={{ color: 'var(--color-text-dim)', margin: '16px 0 24px' }}>{error || 'This book is not yet playable.'}</p>
          <button className="btn-secondary" onClick={() => router.push(`/books/${bookSlug}`)}>Return to Read Mode</button>
        </div>
      </main>
    );
  }

  if (!session?.selectedCharacter) {
    return (
      <CharacterSelectScreen
        bookTitle={payload.book.title}
        onSelect={handleCharacterSelect}
        onBack={() => router.push(`/books/${bookSlug}`)}
      />
    );
  }

  return (
    <main style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, rgba(128,0,0,0.16) 0%, #0C0806 62%)' }}>
      <button
        onClick={() => setIsStoryMenuOpen(true)}
        style={{
          position: 'fixed',
          top: 14,
          left: 18,
          zIndex: 140,
          background: 'rgba(12,8,6,0.82)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 999,
          color: 'var(--color-gold-light)',
          padding: '10px 14px',
          fontSize: '0.8rem',
          fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(16px)',
        }}
      >
        ☰ Story Menu
      </button>

      <AnimatePresence>
        {isStoryMenuOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsStoryMenuOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.46)', zIndex: 180 }}
            />
            <motion.aside
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              style={{
                position: 'fixed', top: 64, left: 18, bottom: 18, zIndex: 190,
                width: 'min(380px, calc(100vw - 36px))',
                background: 'rgba(18,12,10,0.94)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 28,
                padding: 22,
                overflowY: 'auto',
                backdropFilter: 'blur(22px)',
                boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
                    Story Menu
                  </div>
                  <div className="font-serif" style={{ fontSize: '1.35rem', color: 'var(--color-gold-light)', fontWeight: 700 }}>
                    {currentSceneSummary?.title}
                  </div>
                </div>
                <button
                  onClick={() => setIsStoryMenuOpen(false)}
                  style={{
                    width: 34, height: 34, borderRadius: '50%', cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'white',
                  }}
                >
                  ✕
                </button>
              </div>

              {currentSceneSummary ? (
                <p style={{ fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--color-text-dim)', margin: '0 0 20px' }}>
                  {currentSceneSummary.short_summary}
                </p>
              ) : null}

              {currentQuest ? (
                <section style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
                    This Chapter Invites You To
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {currentQuest.objectives.map(objective => (
                      <div key={objective.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 16,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: objective.completed ? 'rgba(255,215,0,0.18)' : 'transparent',
                          border: `1px solid ${objective.completed ? 'rgba(255,215,0,0.38)' : 'rgba(255,255,255,0.14)'}`,
                          color: objective.completed ? 'var(--color-gold-light)' : 'transparent',
                          fontSize: '0.72rem',
                        }}>
                          ✓
                        </div>
                        <span style={{
                          fontSize: '0.82rem', lineHeight: 1.4,
                          color: objective.completed ? 'var(--color-text-dim)' : 'var(--color-text-light)',
                        }}>
                          {objective.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {presentCharacters.length > 0 ? (
                <section style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
                    Characters Here
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {presentCharacters.map(character => (
                      <div key={character.slug} style={{
                        padding: '12px 14px', borderRadius: 18,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--color-gold-light)' }}>{character.name}</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--color-text-dim)', marginTop: 2 }}>{character.role}</div>
                        <div style={{ fontSize: '0.76rem', lineHeight: 1.55, color: 'var(--color-text-dim)', marginTop: 8 }}>
                          {character.short_summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
                  Chapters
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {payload.scenes.map((scene, index) => {
                    const unlocked = isSceneUnlocked(scene, index, payload.scenes, visitedSceneIds);
                    const current = scene.scene_id === session.currentSceneId;

                    return (
                      <button
                        key={scene.scene_id}
                        disabled={!unlocked}
                        onClick={() => {
                          if (!unlocked) return;
                          setIsStoryMenuOpen(false);
                          handleSceneSelect(scene.scene_id);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                          padding: '12px 14px', borderRadius: 18,
                          background: current ? 'rgba(255,153,51,0.14)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${current ? 'rgba(255,153,51,0.28)' : 'rgba(255,255,255,0.06)'}`,
                          color: unlocked ? 'var(--color-text-light)' : 'rgba(255,255,255,0.35)',
                          textAlign: 'left', cursor: unlocked ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                            Chapter {scene.order_index}: {scene.title}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', marginTop: 3 }}>
                            {current ? 'You are here' : unlocked ? 'Open this chapter' : 'Continue the story to unlock'}
                          </div>
                        </div>
                        <div style={{ fontSize: '0.9rem', color: current ? 'var(--color-gold-light)' : 'var(--color-text-dim)' }}>
                          {current ? '●' : unlocked ? '→' : '🔒'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {quietTools.length > 0 ? (
                <section style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
                    Available When You Ask
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {quietTools.map(tool => (
                      <span key={tool} style={{
                        padding: '6px 10px', borderRadius: 999,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'var(--color-text-dim)', fontSize: '0.74rem',
                      }}>
                        {tool}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {currentSceneSummary?.source_notes ? (
                <section style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
                    Source Note
                  </div>
                  <div style={{
                    padding: '12px 14px', borderRadius: 18,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: 'var(--color-text-dim)', fontSize: '0.78rem', lineHeight: 1.6,
                  }}>
                    {currentSceneSummary.source_notes}
                  </div>
                </section>
              ) : null}

              <div style={{ display: 'grid', gap: 10 }}>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setIsStoryMenuOpen(false);
                    router.push(`/books/${bookSlug}`);
                  }}
                  style={{ justifyContent: 'center', textDecoration: 'none' }}
                >
                  Open Read Mode
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setIsStoryMenuOpen(false);
                    router.push('/books');
                  }}
                  style={{ justifyContent: 'center', textDecoration: 'none' }}
                >
                  Explore Worlds
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setIsStoryMenuOpen(false);
                    handleResetCharacter();
                  }}
                  style={{ justifyContent: 'center' }}
                >
                  Choose Another Character
                </button>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '72px 18px 32px' }}>
        <div style={{ marginBottom: 18, padding: '0 8px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
            {payload.book.title} · {session.selectedCharacter.name}
          </div>
          <div className="font-serif" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: 'var(--color-gold-light)', fontWeight: 700 }}>
            A living storybook powered by AI
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(180deg, rgba(28,18,14,0.92), rgba(12,8,6,0.96))',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 28,
          boxShadow: '0 28px 90px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 18px 0' }}>
            <SceneViewer
              bookSlug={bookSlug}
              initialSceneId={session.currentSceneId}
              sceneBasePath={`/play/${bookSlug}`}
              activeSceneId={session.currentSceneId}
              embedded
              externalGameState={session.gameState}
              showModeSwitcher={false}
              showSourceNote={false}
              showSceneNavigation={false}
              showLearningPoints={false}
              showNarrationButton={false}
              onSceneChange={handleSceneChange}
              onGameStateChange={handleGameStateChange}
            />
          </div>

          <div style={{ padding: '20px 20px 24px' }}>
            <div style={{ display: 'grid', gap: 10 }}>
              {visibleActions.map(action => (
                <button
                  key={action.id}
                  onClick={() => {
                    if (action.type === 'TALK' || action.type === 'CREATE' || action.type === 'USE_TOOL') {
                      setPendingAction(action);
                      setPendingInput('');
                      return;
                    }

                    void handleActionSelect(action);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--color-text-light)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>{action.emoji}</span>
                  {action.label}
                </button>
              ))}
            </div>

            {pendingAction ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleActionSelect(pendingAction, pendingInput);
                }}
                style={{
                  marginTop: 16,
                  display: 'grid',
                  gap: 10,
                  padding: 14,
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)' }}>
                  {pendingAction.label}
                </div>
                <input
                  value={pendingInput}
                  onChange={(event) => setPendingInput(event.target.value)}
                  placeholder="Say it simply..."
                  style={{
                    minHeight: 44,
                    borderRadius: 12,
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    padding: '0 12px',
                    color: 'white',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingAction(null);
                      setPendingInput('');
                    }}
                    style={{
                      borderRadius: 999,
                      padding: '6px 12px',
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.16)',
                      color: 'var(--color-text-dim)',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!pendingInput.trim() || isProcessingAction}
                    style={{
                      borderRadius: 999,
                      padding: '6px 14px',
                      background: 'linear-gradient(135deg, var(--color-saffron), var(--color-gold))',
                      border: 'none',
                      color: '#1a0e0a',
                      cursor: pendingInput.trim() ? 'pointer' : 'not-allowed',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      opacity: pendingInput.trim() ? 1 : 0.6,
                    }}
                  >
                    Continue
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}